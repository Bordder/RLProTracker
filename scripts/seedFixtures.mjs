// A small, committed copy of the live feeds, and the same feeds as they will
// look on the first day of a season.
//
//   node scripts/seedFixtures.mjs              refresh both sets from the site
//   node scripts/seedFixtures.mjs --players 20 keep more rows
//
// Two jobs, one file, because they are the same job twice.
//
// 1. LOCAL DEVELOPMENT. scripts/serve.mjs copies data/derived into web/ and
//    serves that, so a checkout with no collector output renders an empty
//    board, and pulling the `data` branch to fix it overwrites the
//    hand-maintained roster. Verifying the podium fix on 10 September needed
//    derived JSON copied in by hand before the page would draw a single row.
//
// 2. THE SEASON BOUNDARY. Rocket League Season 23 ends on 23 September 2026.
//    At that moment every cumulative counter on the board restarts at zero,
//    the whole roster is soft-reset to roughly the same rating, and 90 days of
//    rating history is purged by our own hand. The board has never been seen in
//    that state, and the first chance to see it is the morning it happens
//    unless it can be seeded on purpose. That is what season-reset/ is.
//
// The reset is modelled, not guessed:
//
//   seasonGames  null. matchesPlayed is cumulative WITHIN a season and the
//                collector has no pre-boundary reading to diff against, so the
//                honest value is "not known yet", not 0.
//   games        every window zeroed and marked partial: the snapshots behind
//                d1/d7/d14 are purged with the season.
//   mmr          compressed toward the middle of each playlist, keeping rank
//                order. The soft reset is what makes a rating column
//                meaningless for a fortnight, and it is per playlist: 1v1 and
//                3v3 sit on lower scales than 2v2, so one flat number across
//                all three produces a board no season has ever looked like.
//                A tracked pro does not land on the 1660 the general
//                population resets onto - this roster compresses to roughly
//                2400-2670 in 2v2 - so the anchor is each playlist's own
//                median across the live field.
//   tier         re-derived from the reset rating against the live tier bands,
//                rather than carried over from a rating that no longer exists.
//   history      empty per player. The chart draws from nothing and fills in.
//   hours        UNCHANGED. Steam playtime is a rolling two weeks of wall
//                clock and knows nothing about seasons - a detail worth
//                keeping, because it is the one column that stays truthful
//                across the boundary.

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const SITE = process.env.SITE ?? "https://198x.online";
const OUT = join(ROOT, "data", "fixtures");
const KEEP = Number(process.argv[process.argv.indexOf("--players") + 1]) || 12;

// How much of a player's distance from the middle of their playlist survives
// the reset. 0.35 keeps the order of the board intact - the best player is
// still top - while collapsing the range, which is the property that matters:
// the gap that makes the column worth reading is gone for a fortnight.
const KEEP_SPREAD = 0.35;

const FILES = [
  "tracker.json", "team-tracker.json", "team-hours.json",
  "steam-hours.json", "presence-hours.json", "mmr-history.json",
];

const get = async (file) => {
  const res = await fetch(`${SITE}/data/${file}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.json();
};

const write = async (dir, file, doc) => {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, file), `${JSON.stringify(doc, null, 1)}\n`);
};

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : Math.round((s[i - 1] + s[i]) / 2);
};

const tierFor = (bands, rating) =>
  bands?.find((b) => rating >= b.min && rating < b.max)?.name ?? bands?.[bands.length - 1]?.name ?? null;

// ---- trim ------------------------------------------------------------------

const docs = Object.fromEntries(await Promise.all(FILES.map(async (f) => [f, await get(f)])));

// Keep whole teams rather than the top N players outright: a team row averages
// its players, so a half-kept team produces averages that match nothing.
const wanted = [];
const seenTeams = new Set();
for (const p of docs["tracker.json"].players) {
  if (wanted.length >= KEEP && !seenTeams.has(p.team)) continue;
  wanted.push(p);
  seenTeams.add(p.team);
}
const ids = new Set(wanted.map((p) => p.id));

const trimmed = {
  "tracker.json": { ...docs["tracker.json"], players: wanted },
  "team-tracker.json": {
    ...docs["team-tracker.json"],
    teams: docs["team-tracker.json"].teams.filter((t) => seenTeams.has(t.team)),
  },
  "steam-hours.json": {
    ...docs["steam-hours.json"],
    players: docs["steam-hours.json"].players.filter((p) => ids.has(p.id)),
  },
  "presence-hours.json": {
    ...docs["presence-hours.json"],
    players: docs["presence-hours.json"].players.filter((p) => ids.has(p.id)),
  },
  "team-hours.json": {
    ...docs["team-hours.json"],
    teams: docs["team-hours.json"].teams.filter((t) => seenTeams.has(t.team)),
  },
  "mmr-history.json": {
    ...docs["mmr-history.json"],
    players: Object.fromEntries(Object.entries(docs["mmr-history.json"].players).filter(([id]) => ids.has(id))),
  },
};

for (const [file, doc] of Object.entries(trimmed)) await write(OUT, file, doc);

// ---- the same board, the morning after a season ends ------------------------

const zeroWindows = (games) =>
  Object.fromEntries(Object.entries(games ?? {}).map(([pl, w]) => [
    pl,
    Object.fromEntries(Object.keys(w).map((k) => [k, { games: 0, partial: true }])),
  ]));

const tiers = docs["mmr-history.json"].tiers ?? {};

// The middle of each playlist, across the WHOLE live field rather than the
// trimmed sample, so a smaller seed does not move the anchor.
const mid = {};
for (const pl of ["ones", "twos", "threes"]) {
  const vals = docs["tracker.json"].players.map((p) => p.mmr?.[pl]).filter((v) => Number.isFinite(v));
  mid[pl] = median(vals);
}
const compress = (pl, v) =>
  Number.isFinite(v) && mid[pl] != null ? Math.round(mid[pl] + (v - mid[pl]) * KEEP_SPREAD) : v;

// When this modelled season began: the moment the fixtures are made, which is
// the only instant the board could honestly claim. It is what purgeSeason.mjs
// writes into the history at a real changeover, carried through to the feed.
const STARTED = new Date().toISOString();

const reset = {
  "tracker.json": {
    ...trimmed["tracker.json"],
    seasonStartedAt: STARTED,
    players: wanted.map((p) => {
      const mmr = Object.fromEntries(Object.entries(p.mmr ?? {}).map(([pl, v]) => [pl, compress(pl, v)]));
      return {
        ...p,
        mmr,
        tier: Object.fromEntries(Object.entries(mmr).map(([pl, v]) => [pl, tierFor(tiers[pl], v)])),
        seasonGames: null,
        games: zeroWindows(p.games),
        // Nobody has played a game in the new season yet, so nothing is in a
        // session and nothing has a last-played inside it.
        session: null,
        lastPlayedAt: null,
      };
    }),
  },
  "team-tracker.json": {
    ...trimmed["team-tracker.json"],
    teams: trimmed["team-tracker.json"].teams.map((t) => ({
      ...t,
      avgMmr: Object.fromEntries(Object.entries(t.avgMmr ?? {}).map(([pl, v]) => [pl, compress(pl, v)])),
      seasonGames: null,
      // null, not 0. The player rows say "pending" for a window with no
      // history behind it, and a team row saying 0 next to them claims a
      // measurement nobody has.
      games: Object.fromEntries(Object.keys(t.games ?? {}).map((k) => [k, null])),
    })),
  },
  // Team hours are Steam hours summed. Same as the player ones: not seasonal.
  "team-hours.json": trimmed["team-hours.json"],
  // Hours survive a season. Only the ranked numbers restart.
  "steam-hours.json": trimmed["steam-hours.json"],
  "presence-hours.json": trimmed["presence-hours.json"],
  "mmr-history.json": {
    ...trimmed["mmr-history.json"],
    players: Object.fromEntries(Object.keys(trimmed["mmr-history.json"].players).map((id) => [id, {}])),
  },
};

for (const [file, doc] of Object.entries(reset)) await write(join(OUT, "season-reset"), file, doc);

// ---- and a few hours into it -------------------------------------------------
//
// season-reset is the instant of the changeover: nobody has a count yet, so
// every games figure on the board is "not known" rather than a number. The
// board spends that state for minutes. What it actually spends the first day
// in is a page of small, real counts - four games here, eleven there - which
// is when "Most Active Pro" crowns whoever queued first and the totals read as
// a field that stopped playing. That is the state the season note exists for,
// so it gets a fixture of its own.
//
// Counts are deterministic, not random, so two runs produce the same board and
// a screenshot can be compared against the last one.
const early = (i) => {
  const twos = (i * 7) % 13, threes = (i * 5) % 9, ones = i % 3 === 0 ? 2 : 0;
  return { ones, twos, threes, total: ones + twos + threes };
};
const earlyPlayers = reset["tracker.json"].players.map((p, i) => ({
  ...p,
  seasonGames: early(i),
  // A day in, the 24-hour window has not filled yet: still partial, but with
  // what has been counted so far in it.
  games: Object.fromEntries(Object.entries(p.games ?? {}).map(([pl, w]) => [
    pl,
    Object.fromEntries(Object.keys(w).map((k) => [k, { games: early(i)[pl] ?? 0, partial: true }])),
  ])),
}));
const teamTotal = (team) => earlyPlayers
  .filter((p) => p.team === team)
  .reduce((n, p) => n + p.seasonGames.total, 0);
const dayOne = {
  ...reset,
  "tracker.json": { ...reset["tracker.json"], players: earlyPlayers },
  "team-tracker.json": {
    ...reset["team-tracker.json"],
    teams: reset["team-tracker.json"].teams.map((t) => ({ ...t, seasonGames: teamTotal(t.team) })),
  },
};
for (const [file, doc] of Object.entries(dayOne)) await write(join(OUT, "season-day-one"), file, doc);

console.log(`${wanted.length} players, ${seenTeams.size} teams`);
console.log(`  ${OUT}`);
console.log(`  ${join(OUT, "season-reset")}  (seasonGames null, no history, 2v2 around ${mid.twos})`);
console.log(`  ${join(OUT, "season-day-one")}  (small counts, the first day of a season)`);

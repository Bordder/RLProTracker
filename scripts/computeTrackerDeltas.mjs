// Turn tracker snapshots into current MMR + ranked games played per window.
//
// Snapshots are now partial (each run scrapes only the due players), so this is
// player-centric: for each player we gather every reading across all snapshots,
// take the latest for MMR, and diff matchesPlayed against the reading nearest
// (now - window) for games-per-window. Negative diffs (season resets) clamp to 0.
//
// Playlist keys: ones (1v1), twos (2v2), threes (3v3).
// Writes data/derived/tracker.json.  Usage: npm run tracker:deltas

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { historyToSnaps } from "./trackerHistory.mjs";
import { updatePeaks, peakFor, readStore, writeStore } from "./peakMmr.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAP_DIR = join(ROOT, "data", "tracker-snapshots");
const HISTORY_FILE = join(ROOT, "data", "tracker-history.json");
const STATE_FILE = join(ROOT, "data", "tracker-state.json");

// Fail open: a missing or unreadable state file publishes the board without
// presence rather than failing the run. Presence is an extra on top of the
// numbers, and no board is worse than a board with one column short.
const readJson = async (f) => { try { return JSON.parse(await readFile(f, "utf8")); } catch { return {}; } };
const HOUR = 3600e3;
const WINDOWS = { d1: 24 * HOUR, d7: 7 * 24 * HOUR, d14: 14 * 24 * HOUR };
const PL = { ones: "d1", twos: "d2", threes: "d3" }; // output key -> snapshot key

// Two readings of the same player belong to one session while the gap between
// the games they record is under this. Rocket League matches run about five to
// seven minutes and the collector samples every few minutes, so half an hour is
// comfortably longer than a queue plus a match and short enough that yesterday
// evening never merges into this morning.
export const SESSION_GAP_MS = 30 * 60e3;

// Nobody finishes a ranked match in under five minutes including the queue, so
// twelve an hour is already generous and fifteen leaves room for a fast night.
// A jump above that line is not play: it is the counter moving under us,
// because the account changed or the wiki had linked the wrong one. Those
// windows report as still filling rather than as a record-breaking day.
export const MAX_GAMES_PER_HOUR = 15;

// Pure core (no IO) so it can be unit-tested. `snaps` is [{ t, rows }] in any
// order; returns { now, players } where now is the latest snapshot time and
// players is the derived per-player MMR/tier/games-per-window array.
// `rosterIds`, when given, is the set of players currently on the roster.
// Anything else is dropped from the output.
//
// History deliberately keeps a player's last reading however old it is, so
// someone who stops being scraped holds their values rather than vanishing
// mid-session. That is right for a temporary gap and wrong for a departure: a
// team removed from the roster on 4 September was still on the board hours
// later, because nothing downstream ever consulted the roster again. The
// history is the record of what was seen; the roster decides what is published.
export function computeTrackerPlayers(snaps, rosterIds) {
  const sorted = [...snaps].sort((a, b) => a.t - b.t);
  const now = sorted[sorted.length - 1].t;

  // gather per-player readings (only rows that actually have playlist data)
  const byPlayer = new Map(); // id -> { meta, readings:[{t, playlists}] }
  for (const snap of sorted) {
    for (const row of snap.rows) {
      if (!row.playlists) continue;
      if (!byPlayer.has(row.id)) byPlayer.set(row.id, { meta: { id: row.id, name: row.name, team: row.team }, readings: [] });
      byPlayer.get(row.id).readings.push({ t: snap.t, who: row.who ?? null, playlists: row.playlists });
    }
  }

  const readingAtOrBefore = (readings, target) => {
    let pick = null;
    for (const r of readings) if (r.t <= target) pick = r;
    return pick ?? readings[0];
  };

  const players = [];
  for (const { meta, readings: allReadings } of byPlayer.values()) {
    if (rosterIds && !rosterIds.has(meta.id)) continue;
    allReadings.sort((a, b) => a.t - b.t);
    // Readings from a different account cannot be diffed against today's: a
    // switch from a wrong Steam id to the right Epic profile would read as a
    // few thousand games played. Readings from before this field existed carry
    // no account at all, and those are kept: treating them as foreign would
    // reset every window on the board the day it shipped.
    const currentWho = allReadings[allReadings.length - 1]?.who ?? null;
    const readings = currentWho
      ? allReadings.filter((r) => !r.who || r.who === currentWho)
      : allReadings;
    const latest = readings[readings.length - 1];
    const mmr = {}, tier = {}, games = { ones: {}, twos: {}, threes: {}, total: {} };
    // seasonGames = cumulative ranked matches this season (matchesPlayed from the
    // latest reading). Available immediately from one snapshot, unlike the windowed
    // counts which need history to accumulate.
    const seasonGames = { ones: null, twos: null, threes: null, total: null };

    for (const [outKey, snapKey] of Object.entries(PL)) {
      const cur = latest.playlists?.[snapKey] ?? null;
      mmr[outKey] = cur?.rating ?? null;
      tier[outKey] = cur?.tier ?? null;
      seasonGames[outKey] = cur?.matches ?? null;

      for (const [wk, span] of Object.entries(WINDOWS)) {
        const past = readingAtOrBefore(readings, now - span);
        const haveHistory = past.t <= now - span;
        const curM = cur?.matches ?? null;
        const pastM = past.playlists?.[snapKey]?.matches ?? null;
        let g = curM != null && pastM != null ? Math.max(0, curM - pastM) : null;
        let implausible = false;
        if (g != null) {
          const hours = Math.max(1 / 60, (now - past.t) / 3600e3);
          if (g > MAX_GAMES_PER_HOUR * hours) { implausible = true; g = null; }
        }
        games[outKey][wk] = { games: g, partial: !haveHistory || implausible };
      }
    }

    // The total is still filling if ANY playlist is. It used to take the flag
    // from 1v1 alone, so a 2v2 window thrown out as implausible left the
    // other two summed and published as if they were the whole count.
    for (const wk of Object.keys(WINDOWS)) {
      const pls = ["ones", "twos", "threes"];
      const vals = pls.map((k) => games[k][wk].games).filter((v) => v != null);
      games.total[wk] = {
        games: vals.length ? vals.reduce((a, b) => a + b, 0) : null,
        partial: pls.some((k) => games[k][wk].partial),
      };
    }
    const sVals = ["ones", "twos", "threes"].map((k) => seasonGames[k]).filter((v) => v != null);
    seasonGames.total = sVals.length ? sVals.reduce((a, b) => a + b, 0) : null;

    // When a player last actually played, and the session that is still running.
    //
    // The board's headline question is who is on the ladder now, and Steam
    // cannot answer it: presence is only visible for profiles that already
    // publish playtime. Cumulative match counts can. A count that moved between
    // two readings is a game finished in that gap, which works for every
    // tracked player regardless of their Steam privacy.
    const totals = readings.map((r) => {
      const vals = Object.values(PL)
        .map((k) => r.playlists?.[k]?.matches)
        .filter((v) => v != null);
      return { t: r.t, m: vals.length ? vals.reduce((a, b) => a + b, 0) : null };
    });

    const bumps = [];
    for (let i = 1; i < totals.length; i++) {
      const prev = totals[i - 1], cur = totals[i];
      if (prev.m == null || cur.m == null) continue;
      // A season reset drops the count; that is not games played.
      if (cur.m > prev.m) bumps.push({ at: cur.t, since: prev.t, games: cur.m - prev.m });
    }

    let lastPlayedAt = null, session = null;
    if (bumps.length) {
      const last = bumps[bumps.length - 1];
      lastPlayedAt = new Date(last.at).toISOString();
      let start = last.since, played = 0, newer = null;
      for (let i = bumps.length - 1; i >= 0; i--) {
        const b = bumps[i];
        // Idle stretch between two bursts of games: the session ended there.
        if (newer && newer.since - b.at > SESSION_GAP_MS) break;
        played += b.games;
        // The games in this bump happened somewhere inside its own window. If
        // that window is longer than a session, we only know the player was
        // playing when we saw it, so the session starts there and nothing
        // earlier joins it.
        if (b.at - b.since > SESSION_GAP_MS) { start = b.at; break; }
        start = b.since;
        newer = b;
      }
      session = { startedAt: new Date(start).toISOString(), games: played };
    }

    players.push({ ...meta, updatedAt: new Date(latest.t).toISOString(), lastPlayedAt, session, mmr, tier, seasonGames, games });
  }

  return { now, players };
}

// Each player's current account: the one their newest reading came from, or
// null for a reading that carries none. Which peak is published depends on it
// (see peakFor in peakMmr.mjs).
export function currentAccounts(snaps) {
  const out = new Map();
  for (const snap of [...snaps].sort((a, b) => a.t - b.t)) {
    for (const row of snap.rows) if (row.playlists) out.set(row.id, row.who ?? null);
  }
  return out;
}

// Steam's live answer, attached to the rows about to be published.
//
// The board's "Playing" mark is proof: a cumulative match count that moved, so
// the player finished a ranked game. Proof is slow. A match runs five to seven
// minutes and the count only moves when it ends, so the earliest the mark can
// appear is several minutes after somebody sat down to play, and on a bad
// alignment the run that would have caught it has just gone.
//
// presenceHot already asks Steam who has Rocket League open, at the top of
// every run, for scheduling. That answer arrives while the first match is
// still being played and it was being thrown away. It is weaker - the app
// being open covers menus, freeplay, training and casual, so roughly twice as
// many report in-game as are on the ladder - which is why it is published
// beside the proof rather than folded into it.
//
// Only a check that actually saw the profile is published. "unknown" is a
// private profile, where absence of presence is not absence of play, and
// publishing false for it would state something nobody knows.
export function withPresence(players, state = {}) {
  return players.map((p) => {
    const st = state[p.id];
    if (!st || !st.presence || st.presence === "unknown" || !st.presenceAt) return p;
    return { ...p, steam: { inGame: st.presence === "in", at: st.presenceAt } };
  });
}

// The rating series behind the charts, as its own small feed.
//
// It is separate from tracker.json because it is a different shape and a
// different lifetime: the board's figures are rewritten every couple of
// minutes, where a fortnight of ratings barely moves. Keeping it out means the
// main payload does not grow by a history nobody has asked to see yet.
//
// Encoded as offsets from a base rather than absolute values: whole minutes
// since `base`, and the rating itself, which is what makes 94 players of
// history a few tens of kilobytes instead of a few hundred. The dedupe in
// rollingHistory already dropped every reading that repeated the one before,
// so what is left is exactly the points where a rating changed - lossless for
// a step chart, and nothing is thinned out here.
export function computeMmrHistory(snaps, rosterIds = null, keepMs = 90 * 24 * HOUR) {
  const sorted = [...snaps].sort((a, b) => a.t - b.t);
  const now = sorted.length ? sorted[sorted.length - 1].t : Date.now();
  const from = now - keepMs;
  const base = Math.floor(from / 60000) * 60000;

  const byPlayer = new Map();
  for (const snap of sorted) {
    if (snap.t < from) continue;
    for (const row of snap.rows) {
      if (rosterIds && !rosterIds.has(row.id)) continue;
      if (!byPlayer.has(row.id)) byPlayer.set(row.id, { ones: [], twos: [], threes: [] });
      const series = byPlayer.get(row.id);
      const at = Math.round((snap.t - base) / 60000);
      for (const [outKey, snapKey] of Object.entries(PL)) {
        const r = row.playlists?.[snapKey]?.rating;
        if (r == null) continue;
        const arr = series[outKey];
        // Only the points where it changed, but a flat run keeps BOTH its
        // ends. Collapsing one to a single point would have the chart draw a
        // gradual slope from the old rating to the new across the whole run,
        // where what happened was a jump and then no movement at all. Same
        // rule as collapseUnchanged in rollingHistory, for the same reason.
        const last = arr[arr.length - 1], prev = arr[arr.length - 2];
        if (last && last[1] === r) {
          if (prev && prev[1] === r) last[0] = at;  // extend the run's tail
          else arr.push([at, r]);                    // second end of the run
          continue;
        }
        arr.push([at, r]);
      }
    }
  }

  const players = {};
  for (const [id, series] of byPlayer) {
    const out = {};
    for (const k of ["ones", "twos", "threes"]) if (series[k].length) out[k] = series[k];
    if (Object.keys(out).length) players[id] = out;
  }
  return { base, players, tiers: tierBands(sorted, from) };
}

// Where each rank sits on the rating scale, per playlist.
//
// Derived from the readings themselves rather than a hardcoded table: every
// snapshot carries the tier name beside the rating, so a fortnight of 94
// players is thousands of labelled samples. A table of thresholds would be one
// more thing to notice had gone stale after a season change; this cannot.
//
// Bands are made contiguous by running each one up to where the next begins,
// so the chart has no unexplained gaps between ranks.
export function tierBands(snaps, from = -Infinity) {
  const seen = { ones: new Map(), twos: new Map(), threes: new Map() };
  for (const snap of snaps) {
    if (snap.t < from) continue;
    for (const row of snap.rows) {
      for (const [outKey, snapKey] of Object.entries(PL)) {
        const pl = row.playlists?.[snapKey];
        if (!pl || pl.rating == null || !pl.tier) continue;
        const m = seen[outKey];
        const cur = m.get(pl.tier);
        if (!cur) m.set(pl.tier, { name: pl.tier, min: pl.rating, max: pl.rating, n: 1 });
        else {
          if (pl.rating < cur.min) cur.min = pl.rating;
          if (pl.rating > cur.max) cur.max = pl.rating;
          cur.n++;
        }
      }
    }
  }

  const out = {};
  for (const k of ["ones", "twos", "threes"]) {
    const bands = [...seen[k].values()].sort((a, b) => a.min - b.min);
    // A tier seen once or twice is as likely to be a stale reading as a real
    // boundary, and one bad sample would stretch a band across the chart.
    const solid = bands.filter((b) => b.n >= 3);
    for (let i = 0; i < solid.length - 1; i++) solid[i].max = solid[i + 1].min;
    out[k] = solid.map((b) => ({ name: b.name, min: b.min, max: b.max }));
  }
  return out;
}

// Readings come from the rolling history (data/tracker-history.json). The old
// per-run snapshot directory is still read and merged when present, so the
// history accumulated before the switch is not lost; once those files age out
// of the 90-day window the directory can go away entirely.
async function loadSnapshots() {
  const byTime = new Map();

  try {
    const hist = JSON.parse(await readFile(HISTORY_FILE, "utf8"));
    for (const s of historyToSnaps(hist)) byTime.set(s.t, s.rows);
  } catch {}

  try {
    for (const f of await readdir(SNAP_DIR)) {
      if (!f.startsWith("tracker-") || !f.endsWith(".json")) continue;
      const s = JSON.parse(await readFile(join(SNAP_DIR, f), "utf8"));
      const t = Date.parse(s.takenAt);
      if (!byTime.has(t)) byTime.set(t, s.rows);   // history wins on a tie
    }
  } catch {}

  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, rows]) => ({ t, rows }));
}

async function main() {
  const snaps = await loadSnapshots();
  if (!snaps.length) { console.error("no tracker snapshots yet - run npm run fetch:tracker first"); process.exit(1); }

  // Fail open: an unreadable or empty roster publishes everything rather than
  // emptying the board.
  let rosterIds = null;
  // Nationality and Twitch channel, keyed by player id. These live only on the
  // roster: name and team travel on the snapshot rows, but a country is a fact
  // about the person rather than about a reading, so nothing in the history
  // carries it and it has to be joined on here.
  let profiles = new Map();
  try {
    const roster = JSON.parse(await readFile(join(ROOT, "data", "roster.json"), "utf8"));
    const ids = (roster.players ?? []).map((p) => p.id).filter(Boolean);
    if (ids.length) rosterIds = new Set(ids);
    for (const p of roster.players ?? []) {
      if (!p.id) continue;
      // Only publish the fields that are actually set, so a player with neither
      // adds no keys to the feed at all.
      const entry = {};
      if (p.country?.code) entry.country = p.country;
      // Only where there is a real second nationality. The England/United
      // Kingdom pairing is dropped at collection, so anything reaching here is
      // two countries worth naming.
      if (p.country?.code && p.country2?.code) entry.country2 = p.country2;
      if (p.twitch) entry.twitch = p.twitch;
      if (Object.keys(entry).length) profiles.set(p.id, entry);
    }
  } catch { rosterIds = null; profiles = new Map(); }

  const { now, players: computed } = computeTrackerPlayers(snaps, rosterIds);
  // presenceHot writes this at the top of the same run, so it is the freshest
  // thing in the pipeline by a whole scrape.
  const withSteam = withPresence(computed, await readJson(STATE_FILE));

  // Peaks are kept forward rather than derived, because the readings behind
  // them are thinned at 90 days and emptied outright at a season boundary.
  // All time rather than per season, and updated before it is read, so a
  // rating set on this very run is already the peak it produced.
  const peaks = updatePeaks(await readStore(), snaps);
  await writeStore(peaks);
  const accounts = currentAccounts(snaps);
  const players = withSteam.map((p) => {
    const peak = peakFor(peaks, p.id, accounts.get(p.id) ?? null);
    const profile = profiles.get(p.id);
    return { ...p, ...(peak ? { peak } : null), ...profile };
  });
  const dropped = rosterIds ? new Set([].concat(...snaps.map((s) => s.rows.map((r) => r.id)))).size - players.length : 0;
  if (dropped > 0) console.log(`dropped ${dropped} player(s) held in history but no longer on the roster`);

  // When the current ranked season's counts began, if a purge has recorded
  // it. The page uses it to say that seasonGames restarted and on what day;
  // without it, a board of single-digit totals the morning after a changeover
  // reads as the whole field having stopped playing.
  const seasonStartedAt = (await readJson(HISTORY_FILE))?.seasonStartedAt ?? null;

  await mkdir(join(ROOT, "data", "derived"), { recursive: true });
  await writeFile(
    join(ROOT, "data", "derived", "tracker.json"),
    JSON.stringify({
      computedAt: new Date(now).toISOString(),
      ...(seasonStartedAt ? { seasonStartedAt } : null),
      snapshotCount: snaps.length,
      players,
    }, null, 2)
  );
  // A freshness-only companion to tracker.json.
  //
  // /api/status answers open tabs with a single timestamp, and it used to get it
  // by reading all of tracker.json - 180 KB parsed and thrown away to return
  // about 40 bytes. Its edge cache collapses that to one upstream read every 20
  // seconds, but each of those reads still spends GH_TOKEN budget shared with
  // the workflow_dispatch calls that drive the collectors, so polling traffic
  // was measured against the thing that keeps collection running. Writing the
  // timestamp on its own makes the probe's upstream read the same size as its
  // response. Same value, same instant, computed once.
  await writeFile(
    join(ROOT, "data", "derived", "status.json"),
    JSON.stringify({ computedAt: new Date(now).toISOString() })
  );
  const withMmr = players.filter((p) => p.mmr.twos != null).length;
  const inGame = players.filter((p) => p.steam?.inGame).length;
  const atPeak = players.filter((p) => p.peak?.twos != null && p.mmr.twos === p.peak.twos).length;
  console.log(`tracker.json: ${players.length} players, ${withMmr} with 2v2 MMR, ${inGame} in Rocket League, ${atPeak} at their 2v2 peak, ${snaps.length} snapshots`);

  const hist = computeMmrHistory(snaps, rosterIds);
  const histPath = join(ROOT, "data", "derived", "mmr-history.json");
  await writeFile(histPath, JSON.stringify({
    computedAt: new Date(now).toISOString(),
    note: "Rating over the retention window. [minutes since base, rating] per playlist; a run of equal ratings is stored as its two ends. Fetched by the page only when a chart is opened.",
    base: hist.base,
    tiers: hist.tiers,
    players: hist.players,
  }));
  const pts = Object.values(hist.players).reduce((n, s) => n + Object.values(s).reduce((m, a) => m + a.length, 0), 0);
  const kb = ((await readFile(histPath)).length / 1024).toFixed(0);
  console.log(`mmr-history.json: ${Object.keys(hist.players).length} players, ${pts} points, ${kb} KB`);
}

// Run only when invoked directly (so computeTrackerPlayers can be imported for tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAP_DIR = join(ROOT, "data", "tracker-snapshots");
const HISTORY_FILE = join(ROOT, "data", "tracker-history.json");
const HOUR = 3600e3;
const WINDOWS = { d1: 24 * HOUR, d7: 7 * 24 * HOUR, d14: 14 * 24 * HOUR };
const PL = { ones: "d1", twos: "d2", threes: "d3" }; // output key -> snapshot key

// Two readings of the same player belong to one session while the gap between
// the games they record is under this. Rocket League matches run about five to
// seven minutes and the collector samples every few minutes, so half an hour is
// comfortably longer than a queue plus a match and short enough that yesterday
// evening never merges into this morning.
export const SESSION_GAP_MS = 30 * 60e3;

// Pure core (no IO) so it can be unit-tested. `snaps` is [{ t, rows }] in any
// order; returns { now, players } where now is the latest snapshot time and
// players is the derived per-player MMR/tier/games-per-window array.
export function computeTrackerPlayers(snaps) {
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
    allReadings.sort((a, b) => a.t - b.t);
    // Only readings from the account we are currently following can be diffed
    // against today's: a switch from a wrong Steam id to the right Epic profile
    // would otherwise read as a few thousand games played in one window.
    const currentWho = allReadings[allReadings.length - 1]?.who ?? null;
    const sameAccount = allReadings.filter((r) => (r.who ?? null) === currentWho);
    const readings = sameAccount.length ? sameAccount : allReadings;
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
        const g = curM != null && pastM != null ? Math.max(0, curM - pastM) : null;
        games[outKey][wk] = { games: g, partial: !haveHistory };
      }
    }

    for (const wk of Object.keys(WINDOWS)) {
      const vals = ["ones", "twos", "threes"].map((k) => games[k][wk].games).filter((v) => v != null);
      games.total[wk] = { games: vals.length ? vals.reduce((a, b) => a + b, 0) : null, partial: games.ones[wk].partial };
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

// Readings come from the rolling history (data/tracker-history.json). The old
// per-run snapshot directory is still read and merged when present, so the
// history accumulated before the switch is not lost; once those files age out
// of the 15-day window the directory can go away entirely.
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

  const { now, players } = computeTrackerPlayers(snaps);

  await mkdir(join(ROOT, "data", "derived"), { recursive: true });
  await writeFile(
    join(ROOT, "data", "derived", "tracker.json"),
    JSON.stringify({ computedAt: new Date(now).toISOString(), snapshotCount: snaps.length, players }, null, 2)
  );
  const withMmr = players.filter((p) => p.mmr.twos != null).length;
  console.log(`tracker.json: ${players.length} players, ${withMmr} with 2v2 MMR, ${snaps.length} snapshots`);
}

// Run only when invoked directly (so computeTrackerPlayers can be imported for tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

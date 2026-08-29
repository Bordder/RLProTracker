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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAP_DIR = join(ROOT, "data", "tracker-snapshots");
const HOUR = 3600e3;
const WINDOWS = { d1: 24 * HOUR, d7: 7 * 24 * HOUR, d14: 14 * 24 * HOUR };
const PL = { ones: "d1", twos: "d2", threes: "d3" }; // output key -> snapshot key

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
      byPlayer.get(row.id).readings.push({ t: snap.t, playlists: row.playlists });
    }
  }

  const readingAtOrBefore = (readings, target) => {
    let pick = null;
    for (const r of readings) if (r.t <= target) pick = r;
    return pick ?? readings[0];
  };

  const players = [];
  for (const { meta, readings } of byPlayer.values()) {
    readings.sort((a, b) => a.t - b.t);
    const latest = readings[readings.length - 1];
    const mmr = {}, tier = {}, games = { ones: {}, twos: {}, threes: {}, total: {} };

    for (const [outKey, snapKey] of Object.entries(PL)) {
      const cur = latest.playlists?.[snapKey] ?? null;
      mmr[outKey] = cur?.rating ?? null;
      tier[outKey] = cur?.tier ?? null;

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

    players.push({ ...meta, updatedAt: new Date(latest.t).toISOString(), mmr, tier, games });
  }

  return { now, players };
}

async function loadSnapshots() {
  let files;
  try { files = (await readdir(SNAP_DIR)).filter((f) => f.startsWith("tracker-") && f.endsWith(".json")); }
  catch { return []; }
  const snaps = [];
  for (const f of files) {
    const s = JSON.parse(await readFile(join(SNAP_DIR, f), "utf8"));
    snaps.push({ t: Date.parse(s.takenAt), rows: s.rows });
  }
  return snaps.sort((a, b) => a.t - b.t);
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

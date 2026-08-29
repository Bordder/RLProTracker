// Turn tracker snapshots into current MMR + ranked games played per window.
// Games per window come from diffing each playlist's cumulative matchesPlayed
// across snapshots (negative diffs, e.g. a season reset, clamp to 0).
// MMR/tier are the latest values.
//
// Playlist keys: ones (1v1), twos (2v2), threes (3v3).
// Writes data/derived/tracker.json.  Usage: npm run tracker:deltas

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAP_DIR = join(ROOT, "data", "tracker-snapshots");
const HOUR = 3600e3;
const WINDOWS = { d1: 24 * HOUR, d7: 7 * 24 * HOUR, d14: 14 * 24 * HOUR };
const PL = { ones: "d1", twos: "d2", threes: "d3" }; // output key -> snapshot key

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

const snapAtOrBefore = (snaps, target) => {
  let pick = null;
  for (const s of snaps) if (s.t <= target) pick = s;
  return pick ?? snaps[0];
};
const matchesFor = (snap, id, plKey) =>
  snap.rows.find((r) => r.id === id)?.playlists?.[plKey]?.matches ?? null;

async function main() {
  const snaps = await loadSnapshots();
  if (!snaps.length) { console.error("no tracker snapshots yet - run npm run fetch:tracker first"); process.exit(1); }

  const latest = snaps[snaps.length - 1];
  const now = latest.t;
  const players = [];

  for (const row of latest.rows) {
    const mmr = {}, tier = {}, games = { ones: {}, twos: {}, threes: {}, total: {} };

    for (const [outKey, snapKey] of Object.entries(PL)) {
      const cur = row.playlists?.[snapKey] ?? null;
      mmr[outKey] = cur?.rating ?? null;
      tier[outKey] = cur?.tier ?? null;

      for (const [wk, span] of Object.entries(WINDOWS)) {
        const past = snapAtOrBefore(snaps, now - span);
        const haveHistory = past.t <= now - span;
        const curM = cur?.matches ?? null;
        const pastM = matchesFor(past, row.id, snapKey);
        let g = null;
        if (curM != null && pastM != null) g = Math.max(0, curM - pastM);
        games[outKey][wk] = { games: g, partial: !haveHistory };
      }
    }

    // total ranked games per window = sum across the three playlists
    for (const wk of Object.keys(WINDOWS)) {
      const vals = ["ones", "twos", "threes"].map((k) => games[k][wk].games).filter((v) => v != null);
      games.total[wk] = { games: vals.length ? vals.reduce((a, b) => a + b, 0) : null, partial: games.ones[wk].partial };
    }

    players.push({ id: row.id, name: row.name, team: row.team, status: row.status, mmr, tier, games });
  }

  await mkdir(join(ROOT, "data", "derived"), { recursive: true });
  await writeFile(
    join(ROOT, "data", "derived", "tracker.json"),
    JSON.stringify({ computedAt: new Date(now).toISOString(), snapshotCount: snaps.length, players }, null, 2)
  );
  const withMmr = players.filter((p) => p.mmr.twos != null).length;
  console.log(`tracker.json: ${players.length} players, ${withMmr} with 2v2 MMR, ${snaps.length} snapshots`);
}

main().catch((e) => { console.error(e); process.exit(1); });

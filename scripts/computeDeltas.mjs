// Compute per-player hours-played over 24h / 7d / 14d windows by diffing
// Steam snapshots. Writes data/derived/steam-hours.json for the frontend.
//
// "hours in window" = latest total playtime  minus  the total playtime from the
// snapshot nearest (now - window). Needs >=2 snapshots spanning the window;
// until history exists, windows read as partial/unknown. Steam's own 2wk field
// is carried through separately as a fallback.

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAP_DIR = join(ROOT, "data", "snapshots");
const HOUR = 3600e3;
const WINDOWS = { d1: 24 * HOUR, d7: 7 * 24 * HOUR, d14: 14 * 24 * HOUR };

// nearest snapshot at or before target time (fallback: earliest available)
function snapAtOrBefore(snaps, target) {
  let pick = null;
  for (const s of snaps) { if (s.t <= target) pick = s; }
  return pick ?? snaps[0];
}

const foreverFor = (snap, id) => snap.rows.find((r) => r.id === id)?.foreverMin ?? null;

// Pure core (no IO). `snaps` is [{ t, rows }] in any order; the latest snapshot
// defines the player set (Steam snapshots are complete each run). Returns
// { now, players } with total/2wk hours and hours-per-window. Playtime is
// monotonic on Steam, so a window diff is never negative in practice.
export function computeSteamPlayers(snaps) {
  const sorted = [...snaps].sort((a, b) => a.t - b.t);
  const latest = sorted[sorted.length - 1];
  const now = latest.t;
  const players = [];

  for (const row of latest.rows) {
    const cur = row.foreverMin;
    const windows = {};
    for (const [key, span] of Object.entries(WINDOWS)) {
      const past = snapAtOrBefore(sorted, now - span);
      const then = foreverFor(past, row.id);
      const haveHistory = past.t <= now - span;
      windows[key] =
        cur != null && then != null
          ? { hours: +((cur - then) / 60).toFixed(1), partial: !haveHistory }
          : { hours: null, partial: true };
    }
    players.push({
      id: row.id, name: row.name, team: row.team, status: row.status,
      totalHours: cur != null ? +(cur / 60).toFixed(1) : null,
      steam2wkHours: row.twoWeeksMin != null ? +(row.twoWeeksMin / 60).toFixed(1) : null,
      windows,
    });
  }

  return { now, players };
}

async function loadSnapshots() {
  let files;
  try { files = (await readdir(SNAP_DIR)).filter((f) => f.startsWith("steam-") && f.endsWith(".json")); }
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
  if (snaps.length === 0) { console.error("no snapshots yet - run npm run fetch:steam first"); process.exit(1); }

  const { now, players } = computeSteamPlayers(snaps);

  await mkdir(join(ROOT, "data", "derived"), { recursive: true });
  await writeFile(join(ROOT, "data", "derived", "steam-hours.json"),
    JSON.stringify({ computedAt: new Date(now).toISOString(), snapshotCount: snaps.length, players }, null, 2));
  console.log(`derived steam-hours.json  (${players.length} players, ${snaps.length} snapshots)`);
}

// Run only when invoked directly (so computeSteamPlayers can be imported for tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

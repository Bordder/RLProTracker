// Compute per-player hours-played over 24h / 7d / 14d windows by diffing
// Steam snapshots. Writes data/derived/steam-hours.json for the frontend.
//
// "hours in window" = latest total playtime  minus  the total playtime from the
// snapshot nearest (now - window). Needs >=2 snapshots spanning the window;
// until history exists, windows read as partial/unknown. Steam's own 2wk field
// is carried through separately as a fallback.

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAP_DIR = join(ROOT, "data", "snapshots");
const HOUR = 3600e3;
const WINDOWS = { d1: 24 * HOUR, d7: 7 * 24 * HOUR, d14: 14 * 24 * HOUR };

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

// nearest snapshot at or before target time (fallback: earliest available)
function snapAtOrBefore(snaps, target) {
  let pick = null;
  for (const s of snaps) { if (s.t <= target) pick = s; }
  return pick ?? snaps[0];
}

const foreverFor = (snap, id) => snap.rows.find((r) => r.id === id)?.foreverMin ?? null;

async function main() {
  const snaps = await loadSnapshots();
  if (snaps.length === 0) { console.error("no snapshots yet - run npm run fetch:steam first"); process.exit(1); }

  const latest = snaps[snaps.length - 1];
  const now = latest.t;
  const players = [];

  for (const row of latest.rows) {
    const cur = row.foreverMin;
    const windows = {};
    for (const [key, span] of Object.entries(WINDOWS)) {
      const past = snapAtOrBefore(snaps, now - span);
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

  await mkdir(join(ROOT, "data", "derived"), { recursive: true });
  await writeFile(join(ROOT, "data", "derived", "steam-hours.json"),
    JSON.stringify({ computedAt: new Date(now).toISOString(), snapshotCount: snaps.length, players }, null, 2));
  console.log(`derived steam-hours.json  (${players.length} players, ${snaps.length} snapshots)`);
}

main().catch((e) => { console.error(e); process.exit(1); });

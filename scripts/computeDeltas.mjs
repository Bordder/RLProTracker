// Compute per-player hours-played over 24h / 7d / 14d windows by diffing
// Steam snapshots. Writes data/derived/steam-hours.json for the frontend.
//
// "hours in window" = latest total playtime  minus  the total playtime from the
// snapshot nearest (now - window). Needs >=2 snapshots spanning the window;
// until history exists, windows read as partial/unknown. Steam's own 2wk field
// is carried through separately as a fallback.
//
// Total playtime is also kept in a durable last-known store
// (data/last-known-hours.json). Snapshots are pruned after 15 days, so without
// it a player who opens their profile once and closes it again would lose that
// reading for good. When the live value is missing we fall back to the stored
// one and mark it frozen, so the row shows a real (if dated) number instead of
// a blank. Only lifetime total is carried over: Steam's 2-week figure is a
// rolling window, and a stale one would read as current activity when it isn't.

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { historyToSteamSnaps } from "./steamHistory.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAP_DIR = join(ROOT, "data", "snapshots");
const HISTORY_FILE = join(ROOT, "data", "steam-history.json");
const HOUR = 3600e3;
const WINDOWS = { d1: 24 * HOUR, d7: 7 * 24 * HOUR, d14: 14 * 24 * HOUR };

// nearest snapshot at or before target time (fallback: earliest available)
function snapAtOrBefore(snaps, target) {
  let pick = null;
  for (const s of snaps) { if (s.t <= target) pick = s; }
  return pick ?? snaps[0];
}

const foreverFor = (snap, id) => snap.rows.find((r) => r.id === id)?.foreverMin ?? null;

// Merge the newest readings into the durable last-known store. Playtime only
// ever grows, so a reading is kept when it beats the stored one; equal values
// leave the recorded date alone so "as of" reflects when the number last moved.
// Returns a new store, leaving the input untouched.
export function mergeLastKnown(store, snapshotTime, rows) {
  const next = { ...store };
  for (const row of rows) {
    if (row.foreverMin == null) continue;
    const prev = next[row.id];
    if (prev && prev.foreverMin >= row.foreverMin) continue;
    next[row.id] = { foreverMin: row.foreverMin, at: new Date(snapshotTime).toISOString() };
  }
  return next;
}

// Pure core (no IO). `snaps` is [{ t, rows }] in any order; the latest snapshot
// defines the player set (Steam snapshots are complete each run). `lastKnown`
// maps player id -> { foreverMin, at } and supplies a frozen total when Steam
// no longer reports one. Returns { now, players } with total/2wk hours and
// hours-per-window. Playtime is monotonic on Steam, so a window diff is never
// negative in practice.
export function computeSteamPlayers(snaps, lastKnown = {}) {
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

    // A player who runs the game through Epic accrues no Steam playtime, so
    // every figure Steam gives us for them is zero. Publishing those zeros
    // would say "has not played" about someone who plays every day, so they
    // are suppressed and the row shows why instead.
    const onSteam = row.status !== "not-on-steam";

    // Fall back to the stored reading only when Steam gives us nothing now.
    const frozen = cur == null ? lastKnown[row.id] : null;
    players.push({
      id: row.id, name: row.name, team: row.team, status: row.status,
      totalHours: !onSteam ? null : (cur != null ? +(cur / 60).toFixed(1) : (frozen ? +(frozen.foreverMin / 60).toFixed(1) : null)),
      totalHoursFrozenAt: !onSteam ? null : (frozen ? frozen.at : null),
      steam2wkHours: !onSteam || row.twoWeeksMin == null ? null : +(row.twoWeeksMin / 60).toFixed(1),
      windows: onSteam ? windows : Object.fromEntries(Object.keys(WINDOWS).map((k) => [k, { hours: null, partial: true }])),
    });
  }

  return { now, players };
}

// Readings come from the rolling history; the old per-run snapshot directory is
// still merged when present so history from before the switch is not lost.
async function loadSnapshots() {
  const byTime = new Map();
  try {
    const hist = JSON.parse(await readFile(HISTORY_FILE, "utf8"));
    for (const s of historyToSteamSnaps(hist)) byTime.set(s.t, s.rows);
  } catch {}
  try {
    for (const f of await readdir(SNAP_DIR)) {
      if (!f.startsWith("steam-") || !f.endsWith(".json")) continue;
      const s = JSON.parse(await readFile(join(SNAP_DIR, f), "utf8"));
      const t = Date.parse(s.takenAt);
      if (!byTime.has(t)) byTime.set(t, s.rows);   // history wins on a tie
    }
  } catch {}
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, rows]) => ({ t, rows }));
}

const LAST_KNOWN_FILE = join(ROOT, "data", "last-known-hours.json");

async function loadLastKnown() {
  try { return JSON.parse(await readFile(LAST_KNOWN_FILE, "utf8")).players ?? {}; }
  catch { return {}; }
}

async function main() {
  const snaps = await loadSnapshots();
  if (snaps.length === 0) { console.error("no snapshots yet - run npm run fetch:steam first"); process.exit(1); }

  const sorted = [...snaps].sort((a, b) => a.t - b.t);

  // Fold every retained snapshot in, oldest first, so the store also recovers
  // readings taken before it existed and heals if the file is ever lost.
  // Recording happens before computing, so a reading taken this run counts now.
  let lastKnown = await loadLastKnown();
  for (const snap of sorted) lastKnown = mergeLastKnown(lastKnown, snap.t, snap.rows);
  await writeFile(LAST_KNOWN_FILE, JSON.stringify(
    { note: "Durable last-known Steam playtime per player. Survives snapshot pruning so a profile that opens once keeps its reading. Never delete entries.", updatedAt: new Date(sorted[sorted.length - 1].t).toISOString(), players: lastKnown },
    null, 2));

  const { now, players } = computeSteamPlayers(snaps, lastKnown);

  await mkdir(join(ROOT, "data", "derived"), { recursive: true });
  await writeFile(join(ROOT, "data", "derived", "steam-hours.json"),
    JSON.stringify({ computedAt: new Date(now).toISOString(), snapshotCount: snaps.length, players }, null, 2));

  const frozen = players.filter((p) => p.totalHoursFrozenAt).length;
  console.log(`derived steam-hours.json  (${players.length} players, ${snaps.length} snapshots, ${frozen} using stored totals)`);
}

// Run only when invoked directly (so computeSteamPlayers can be imported for tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

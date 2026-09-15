// Clear the season-bound history at a season boundary.
//
//   node scripts/purgeSeason.mjs                  say what would change
//   node scripts/purgeSeason.mjs --apply          do it
//   DATA_DIR=.databranch/data node scripts/...    act on the data worktree
//
// Rocket League Season 23 ends on 23 September 2026 and every season since
// Season 1 has begun the same day the previous one ended. At that moment two
// things about the board stop being true at once:
//
//   The ranked counters restart. matchesPlayed is cumulative WITHIN a season,
//   so every seasonGames figure on the site belongs to a season nobody is
//   playing any more.
//
//   The whole field is soft-reset into a narrow rating band. A rating from
//   before the boundary is not comparable to one after it, so 90 days of
//   history either side of that line would draw the same cliff on 104 charts
//   and invite the reading that everybody collapsed at once.
//
// What this DOES NOT touch, deliberately:
//
//   steam-history.json, presence/, last-known-hours.json. Hours are wall clock
//   on a rolling two weeks and know nothing about seasons. They are the one
//   column that stays truthful across the boundary, and deleting them would
//   blank a third of the board for a fortnight for no reason.
//
//   data/derived/. Every file there is rebuilt from the sources above on the
//   next collector run, so there is nothing to delete and nothing to keep.
//
// It writes a .bak beside anything it changes. The whole point of this script
// is that it runs once a season, under supervision, on data that took three
// months to accumulate.

import { readFile, writeFile, copyFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = process.env.DATA_DIR
  ? (isAbsolute(process.env.DATA_DIR) ? process.env.DATA_DIR : join(ROOT, process.env.DATA_DIR))
  : join(ROOT, "data");
const APPLY = process.argv.includes("--apply");

const HISTORY = join(DATA, "tracker-history.json");
const STATE = join(DATA, "tracker-state.json");

/**
 * The rating history, emptied, with the boundary recorded.
 *
 * Player entries are kept rather than dropped: the names and teams in them are
 * the collector's own index, and rebuilding it from nothing makes the first
 * run after a boundary look like a roster wipe in the logs.
 */
export function purgeHistory(doc, atIso) {
  const players = Object.fromEntries(
    Object.entries(doc?.players ?? {}).map(([id, p]) => [id, { ...p, readings: [] }])
  );
  return { ...doc, updatedAt: atIso, seasonStartedAt: atIso, players };
}

/**
 * Per-player collector state, with the cumulative baseline forgotten.
 *
 * `matches` is what the next delta is measured against. Left at a
 * pre-boundary figure it is simply wrong: the clamp in computeTrackerDeltas
 * ignores the drop, so no phantom games are published, but the first real
 * delta of the season is then measured from a number that no longer exists.
 * null means "establish a new baseline from the next reading", which is what
 * the collector does for a player it has never seen.
 */
export function resetState(doc) {
  return Object.fromEntries(
    Object.entries(doc ?? {}).map(([id, s]) => [id, { ...s, matches: null }])
  );
}

// Imported for the two transforms alone by the tests: nothing read, nothing
// written, and above all nothing purged.
if (import.meta.main) {

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const kb = (n) => `${Math.round(n / 1024)} KB`;

const history = await readJson(HISTORY).catch(() => null);
const state = await readJson(STATE).catch(() => null);

if (!history && !state) {
  console.error(`nothing to purge under ${DATA} - is DATA_DIR right?`);
  process.exit(1);
}

const now = new Date().toISOString();
const lines = [];

if (history) {
  const players = Object.keys(history.players ?? {}).length;
  const readings = Object.values(history.players ?? {}).reduce((a, p) => a + (p.readings?.length ?? 0), 0);
  const size = (await stat(HISTORY)).size;
  lines.push(`tracker-history.json  ${players} players, ${readings} readings, ${kb(size)} -> 0 readings`);
}
if (state) {
  const withBaseline = Object.values(state).filter((s) => s?.matches != null).length;
  lines.push(`tracker-state.json    ${withBaseline} cumulative baselines -> null`);
}
lines.push("untouched             steam-history.json, presence/, last-known-hours.json, derived/");

console.log(`${APPLY ? "purging" : "dry run"}  ${DATA}`);
for (const l of lines) console.log(`  ${l}`);

if (!APPLY) {
  console.log("\nnothing written. re-run with --apply to purge.");
  process.exit(0);
}

if (history) {
  await copyFile(HISTORY, `${HISTORY}.bak`);
  await writeFile(HISTORY, `${JSON.stringify(purgeHistory(history, now))}\n`);
}
if (state) {
  await copyFile(STATE, `${STATE}.bak`);
  await writeFile(STATE, `${JSON.stringify(resetState(state), null, 2)}\n`);
}

console.log(`\npurged at ${now}. .bak files written beside each.`);
console.log("The board shows dashes until the next collector run, and fills in from there.");
}

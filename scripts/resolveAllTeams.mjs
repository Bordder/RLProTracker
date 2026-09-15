// Resolve team names for every event in events.json, one at a time.
//
//   node resolveAllTeams.mjs          only events with no alias file yet
//   node resolveAllTeams.mjs --all    refresh every event
//
// action=parse is limited to 1 request per 30 SECONDS, an order of magnitude
// stricter than the query API the collector uses, so this waits 35 between
// events and takes minutes. That is why it is a separate occasional step and
// not part of the loop: team names change on the order of months, scores on
// the order of minutes.

import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { loadEvents } from "./events.mjs";
import { FIXTURE_DIR, sleep } from "./assemble.mjs";

const run = promisify(execFile);
const ALL = process.argv.includes("--all");
const GAP = 35000;

const events = await loadEvents();
const todo = [];
for (const e of events) {
  const have = await access(join(FIXTURE_DIR, `teams-${e.slug}.json`)).then(() => true, () => false);
  if (ALL || !have) todo.push(e);
}
console.log(`${todo.length} of ${events.length} event(s) to resolve, ~${Math.round((todo.length * GAP) / 60000)} min`);

for (const [n, e] of todo.entries()) {
  if (n) await sleep(GAP);
  try {
    const { stdout } = await run(process.execPath, ["resolveTeams.mjs", e.titles[0].title, e.slug], { cwd: import.meta.dirname });
    process.stdout.write(`${e.slug}: ${stdout}`);
  } catch (err) {
    // One refusal must not abandon the rest; the missing file just means that
    // event keeps showing Liquipedia's short aliases until it is run again.
    console.log(`${e.slug}: FAILED - ${String(err.stderr || err.message).trim().split("\n")[0]}`);
  }
}

// The published feeds are written without indentation.
//
// Every reader parses them - the page, the edge Function, the Worker, the
// smoke check - and none reads them by eye. Indenting doubled them: tracker.json
// 222 KB against 109 KB, bracket.json 598 KB against 215 KB, for identical
// documents, rewritten hundreds of times a day onto the data branch and parsed
// by every board load. A stray `null, 2` puts all of that back silently.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The writer of each feed the site serves, and the file it writes.
const WRITERS = [
  ["scripts/computeTrackerDeltas.mjs", "tracker.json"],
  ["scripts/aggregateTracker.mjs", "team-tracker.json"],
  ["scripts/computeDeltas.mjs", "steam-hours.json"],
  ["scripts/aggregate.mjs", "team-hours.json"],
  ["scripts/computePresenceHours.mjs", "presence-hours.json"],
  ["scripts/assemble.mjs", "OUT_PATH"],
];

test("no published feed is written indented", async () => {
  for (const [file, feed] of WRITERS) {
    const src = await readFile(file, "utf8");
    const at = src.indexOf(`"${feed}"),`) >= 0 ? src.indexOf(`"${feed}"),`) : src.indexOf(`${feed},`);
    assert.notEqual(at, -1, `${file}: cannot find where ${feed} is written`);
    // The write runs from the file name to the end of its statement.
    const stmt = src.slice(at, src.indexOf(";", src.indexOf("JSON.stringify(", at)));
    assert.match(stmt, /JSON\.stringify\(/, `${file}: ${feed} is not written with JSON.stringify`);
    assert.doesNotMatch(stmt, /,\s*null\s*,\s*\d+\s*\)/, `${file}: ${feed} is written indented`);
  }
});

// Records when the ranked collector actually produced data.
//
// Runs last in the tracker pipeline, after aggregation, and appends that run's
// computedAt to a small rolling file. This is deliberately a record of real
// output rather than a heartbeat: a heartbeat says "the workflow started",
// which is exactly the thing that stays true while the scrape underneath it is
// failing. If a timestamp is in here, the board got new numbers.
//
// Usage: node scripts/recordUptime.mjs   (part of `npm run tracker`)

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "data", "derived", "tracker.json");
const OUT = join(ROOT, "data", "derived", "uptime.json");

// 48 hours, so the page can show a full day and still have the day before it
// for context. At a run every 2 minutes that is 1440 entries, and each is a
// whole minute number rather than a date string, which keeps the file at
// roughly 10 KB rather than 40.
const WINDOW_MIN = 48 * 60;

const readJson = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
};

const tracker = await readJson(SOURCE, null);
if (!tracker || !tracker.computedAt) {
  // No snapshot this run (nothing was due, or the scrape produced nothing).
  // Recording anything here would claim an update that did not happen.
  console.log("no tracker.json computedAt - nothing to record");
  process.exit(0);
}

const at = Date.parse(tracker.computedAt);
if (Number.isNaN(at)) {
  console.log(`unparseable computedAt: ${tracker.computedAt}`);
  process.exit(0);
}

const minute = Math.floor(at / 60000);
const existing = await readJson(OUT, {});
const runs = Array.isArray(existing.runs) ? existing.runs : [];

// Same minute twice means the pipeline ran again without a new collection;
// counting it would overstate uptime.
if (!runs.includes(minute)) runs.push(minute);

const cutoff = Math.floor(Date.now() / 60000) - WINDOW_MIN;
const kept = runs.filter((m) => Number.isFinite(m) && m >= cutoff).sort((a, b) => a - b);

await writeFile(
  OUT,
  JSON.stringify({ computedAt: new Date().toISOString(), windowMinutes: WINDOW_MIN, runs: kept }) + "\n"
);
console.log(`uptime.json -> ${kept.length} runs in the last ${WINDOW_MIN / 60}h`);

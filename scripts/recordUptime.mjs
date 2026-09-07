// Records when a collector actually produced data.
//
// Runs last in its pipeline and appends that run's computedAt to a small
// rolling file. This is deliberately a record of real output rather than a
// heartbeat: a heartbeat says "the workflow started", which is exactly the
// thing that stays true while the scrape underneath it is failing. If a
// timestamp is in here, the board got new numbers.
//
// Each collector writes its OWN file. They run in separate workflows and
// publish to the same branch, and publish-data.sh is only safe because each
// collector's file set is disjoint from every other's. One shared uptime file
// would break that: two overlapping runs would each copy a whole file over the
// other, silently dropping the loser's entries.
//
// Usage: node scripts/recordUptime.mjs [tracker|steam|presence]
//        (defaults to tracker, which is how `npm run tracker` calls it)

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The tracker keeps the original filename, so a status page already in the
// wild carries on reading it while the other two roll out.
const FEEDS = {
  tracker: { source: "tracker.json", out: "uptime.json" },
  steam: { source: "steam-hours.json", out: "uptime-steam.json" },
  presence: { source: "presence-hours.json", out: "uptime-presence.json" },
};

const which = process.argv[2] || "tracker";
const feed = FEEDS[which];
if (!feed) {
  console.error(`unknown feed "${which}" - expected one of ${Object.keys(FEEDS).join(", ")}`);
  process.exit(1);
}
const SOURCE = join(ROOT, "data", "derived", feed.source);
const OUT = join(ROOT, "data", "derived", feed.out);

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

const produced = await readJson(SOURCE, null);
if (!produced || !produced.computedAt) {
  // No snapshot this run (nothing was due, or the scrape produced nothing).
  // Recording anything here would claim an update that did not happen.
  console.log(`no ${feed.source} computedAt - nothing to record`);
  process.exit(0);
}

const at = Date.parse(produced.computedAt);
if (Number.isNaN(at)) {
  console.log(`unparseable computedAt: ${produced.computedAt}`);
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
  JSON.stringify({ feed: which, computedAt: new Date().toISOString(), windowMinutes: WINDOW_MIN, runs: kept }) + "\n"
);
console.log(`${feed.out} -> ${kept.length} runs in the last ${WINDOW_MIN / 60}h`);

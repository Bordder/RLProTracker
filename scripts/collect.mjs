// The collector loop: keep bracket.json current while matches are being played.
//
// LOCAL ONLY. Everything in this folder is gitignored.
//
//   node collect.mjs            run until stopped
//   node collect.mjs --once     one cycle, then exit
//   node collect.mjs --dry      no requests at all; rebuild from the cache
//
// Three rules it exists to keep:
//
//  1. Requests only go out for an event inside its date window. Outside that,
//     a cycle is a local reparse and costs Liquipedia nothing.
//  2. Requests are spaced 2 seconds apart, which is what Liquipedia asks for.
//     Ad-hoc requests already got this IP throttled site-wide on 10 September.
//  3. A failed fetch never destroys anything. The cached wikitext stays, the
//     document is rebuilt from it, and the page shows the last good bracket
//     rather than an error - the same choice functions/data/[[path]].js makes.

import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadEvents, eventsDue, allMatches } from "./events.mjs";
import { pollPlan, MINUTE, IDLE, perHour } from "./bracketSchedule.mjs";
import {
  CACHE_DIR, OUT_PATH, sleep, parseEvent, buildDoc, writeAtomic, writeBracketDoc, fetchWikitext,
} from "./assemble.mjs";

const ONCE = process.argv.includes("--once");
const DRY = process.argv.includes("--dry");

const SPACING = 2000;        // Liquipedia's stated limit: 1 request / 2s.
const MAX_BACKOFF = 8;       // cap: 8x IDLE is ~8 hours, long enough to stop.

// How stale a team map has to be before a cycle is allowed to refresh it.
//
// Re-resolving costs one action=parse, which Liquipedia limits to 1 per 30
// SECONDS against the query API's 1 per 2, so it is rationed rather than run
// on every cycle. An hour is far longer than the limit needs and still fixes
// a draw within an hour of it being made, which is the case this exists for:
// the Worlds group draw fills twelve bracket slots that read as "kc" and
// "g2s" until the map catches up.
const RESOLVE_AFTER = 60 * MINUTE;
const run = promisify(execFile);

/** The first line of whatever an exec failure left behind. */
const firstLine = (err) => String(err.stderr || err.message).trim().split("\n")[0].trim();

const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const log = (msg) => console.log(`${stamp()}  ${msg}`);

let stopping = false;
process.on("SIGINT", () => {
  if (stopping) process.exit(1);   // second Ctrl-C: go now
  stopping = true;
  log("stopping after this cycle (Ctrl-C again to quit now)");
});

/** Sleep in short slices so Ctrl-C is not swallowed by an hour-long wait. */
async function restUntil(ms) {
  const until = Date.now() + ms;
  while (!stopping && Date.now() < until) {
    await sleep(Math.min(5000, until - Date.now()));
  }
}

/**
 * Refresh the cached wikitext for the events that are due.
 * Returns how many titles were fetched and how many failed.
 */
async function refresh(due) {
  let fetched = 0, failed = 0, first = true;
  for (const event of due) {
    for (const t of event.titles) {
      if (stopping) return { fetched, failed };
      if (!first) await sleep(SPACING);
      first = false;
      try {
        const text = await fetchWikitext(t.title);
        await writeAtomic(join(CACHE_DIR, t.cache), text);
        fetched++;
        log(`fetched ${t.title} (${Math.round(text.length / 1024)} KB)`);
      } catch (err) {
        failed++;
        // Deliberately not fatal, and deliberately not a cache write. The
        // previous copy is still there and still renders.
        log(`FETCH FAILED ${t.title}: ${err.message} - keeping the cached copy`);
      }
    }
  }
  return { fetched, failed };
}

/** Parse every event from the cache and write bracket.json. */
async function rebuild(events, source) {
  const parsed = [];
  for (const event of events) {
    try {
      parsed.push(await parseEvent(event));
    } catch (err) {
      // One unparseable event must not take the others off the page.
      log(`PARSE FAILED ${event.slug}: ${err.message} - dropping it from this build`);
    }
  }
  if (!parsed.length) {
    log("nothing parsed; leaving the previous bracket.json in place");
    return null;
  }
  const doc = buildDoc(parsed, source);
  await writeBracketDoc(doc);
  return { doc, parsed };
}

async function cycle(events) {
  const now = Date.now();

  // Parse BEFORE deciding what to fetch. An event's dates come from its own
  // page's infobox rather than from events.json, so the cached copy is what
  // says whether the event is running - and parsing is local and free.
  let built = await rebuild(events, "cache");
  if (!built) return { everyMs: IDLE, failed: 0 };

  const due = DRY ? [] : eventsDue(built.parsed, now);
  let failed = 0;
  if (due.length) {
    ({ failed } = await refresh(due));
    // Re-read what was just fetched, so the document and the cadence both
    // reflect this cycle rather than the last one.
    built = (await rebuild(events, "liquipedia")) ?? built;
  } else if (!DRY) {
    log("no event inside its window - no requests this cycle");
  }

  // A followed event whose bracket is showing short codes gets its team map
  // rebuilt, and the document rebuilt after it. Only followed events, so an
  // archive page cannot spend the parse budget, and only one per cycle.
  if (!DRY) {
    const stale = built.parsed.find((e) =>
      due.some((d) => d.slug === e.slug) &&
      e.unresolved?.length &&
      (!e.resolvedAt || Date.now() - Date.parse(e.resolvedAt) > RESOLVE_AFTER));
    if (stale) {
      const title = events.find((e) => e.slug === stale.slug)?.titles[0]?.title;
      log(`unresolved team names on ${stale.slug}: ${stale.unresolved.join(", ")} - re-resolving`);
      try {
        const { stdout } = await run(process.execPath, ["resolveTeams.mjs", title, stale.slug], { cwd: import.meta.dirname });
        log(`${stale.slug}: ${stdout.trim()}`);
        built = (await rebuild(events, built.source)) ?? built;
      } catch (err) {
        // The names stay as they are and the next cycle tries again. A failed
        // resolve must never cost the scores that were just fetched.
        log(`${stale.slug}: resolve failed - ${firstLine(err)}`);
      }
    }
  }

  // Cadence comes from the matches of the events actually being followed. A
  // finished event from 2024 must not hold the fast cadence open.
  const following = built.parsed.filter((e) => due.some((d) => d.slug === e.slug));
  const matches = allMatches(following.flatMap((e) => e.stages));
  const plan = following.length
    ? pollPlan(matches, now)
    : { state: "idle", everyMs: IDLE, reason: "no event running" };

  log(
    `${plan.state} (${plan.reason}); ${built.parsed.length} event(s), ` +
    `${due.length} being followed; next poll in ${Math.round(plan.everyMs / MINUTE)} min (${perHour(plan)}/hour)`
  );
  return { everyMs: plan.everyMs, failed };
}

// ---- run -----------------------------------------------------------------

const events = await loadEvents();
log(`${events.length} event(s) loaded; writing ${OUT_PATH}`);
if (DRY) log("dry run: no requests will be made");

let consecutiveFailures = 0;
for (;;) {
  const { everyMs, failed } = await cycle(events);
  if (ONCE || stopping) break;

  // Back off when the source is refusing us. Doubling per failed cycle turns
  // an outage into a handful of requests rather than one a minute for hours,
  // which is exactly how an IP gets throttled while nobody is watching.
  consecutiveFailures = failed ? consecutiveFailures + 1 : 0;
  const factor = Math.min(2 ** consecutiveFailures, MAX_BACKOFF);
  if (factor > 1) log(`${consecutiveFailures} failing cycle(s) in a row - backing off ${factor}x`);

  await restUntil(everyMs * factor);
}
log("stopped");

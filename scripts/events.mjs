// The event list, and the one question the collector asks of it: is this
// event worth spending a request on right now?
//
// Pure apart from loadEvents, so the windowing logic is testable without a
// clock or a network.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
export const EVENTS_PATH = join(ROOT, "data", "bracket", "events.json");

const DAY = 86400e3;

// A day either side of the published dates. Liquipedia's dates are the
// tournament's local dates and this collector thinks in UTC, so an event
// starting "15 September" in Fort Worth is already under way on the 15th UTC
// and can run past midnight into the 21st. A day of slack costs 24 requests
// at the idle cadence and removes a whole class of off-by-one silence.
export const PAD = DAY;

export async function loadEvents(path = EVENTS_PATH) {
  const doc = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(doc.events)) throw new Error(`${path} has no events array`);
  for (const e of doc.events) {
    if (!e.slug) throw new Error("an event has no slug");
    if (!Array.isArray(e.titles) || !e.titles.length) throw new Error(`${e.slug} has no titles`);
    for (const t of e.titles) {
      if (!t.title || !t.cache) throw new Error(`${e.slug} has a title with no title/cache`);
    }
  }
  return doc.events;
}

/**
 * Is `nowMs` inside this event's date window, padded?
 *
 * `ends` is a date, not an instant, so the window runs to the END of that day.
 * Treating it as midnight would cut the final day off, which for a six-day
 * event means going quiet on the grand final.
 */
export function inWindow(event, nowMs) {
  const from = Date.parse(`${event.starts}T00:00:00Z`) - PAD;
  const to = Date.parse(`${event.ends}T00:00:00Z`) + DAY + PAD;
  // Dates usually come from the page's own infobox, so an event added to
  // events.json but never yet fetched has none. Fetch it once rather than
  // ignoring it forever: that single request is what teaches it its dates.
  if (!Number.isFinite(from) || !Number.isFinite(to)) return true;
  return nowMs >= from && nowMs <= to;
}

/** The events the collector may spend requests on this tick. */
export const eventsDue = (events, nowMs) => events.filter((e) => inWindow(e, nowMs));

/** Every match of a parsed event, flat, for pollPlan. */
export const allMatches = (stages) =>
  stages.flatMap((s) => [
    ...s.brackets.flatMap((b) => b.matches),
    ...s.matchlists.flatMap((l) => l.matches),
  ]);

// When to poll, and how hard.
//
// The point of the page is scores moving during a match, so the cadence has to
// be fast while matches are live. The constraint is that Liquipedia asks for 1
// request per 2 seconds and got this IP throttled site-wide on 10 September
// when that was ignored. Both are satisfiable at once, because a tournament is
// live for a few hours a day, a few weeks a year.
//
// The schedule is derived from the MATCH TIMES in the bracket itself, not from
// the event's date range. A four-hour broadcast inside a six-day event is four
// hours of fast polling, not six days of it.
//
// Pure and clock-injected, so every branch is testable without waiting.

export const MINUTE = 60e3;

// Cadences, slowest to fastest.
export const IDLE = 60 * MINUTE;   // no event running: catch schedule changes
export const EVENT_DAY = 10 * MINUTE; // event running, nothing live right now
export const LIVE = MINUTE;        // a match is under way

// Start polling fast this far before the first match of a session, so the
// first score of the day is not up to a cadence late.
export const WARMUP = 10 * MINUTE;
// How long after its start a match is assumed live when nothing says it
// finished. A Bo7 plus overtime and a stream delay fits inside 2 hours; past
// that, treat it as over rather than polling forever on a stale page.
export const ASSUME_LIVE = 120 * MINUTE;

/**
 * Decide the next poll.
 *
 * @param matches  flat list of { startsAt, upcoming, live, finished } from the
 *                 parsed page
 * @param nowMs    current time
 * @returns { state, everyMs, reason, nextMatchAt }
 */
export function pollPlan(matches, nowMs) {
  const timed = matches
    .filter((m) => m.startsAt)
    .map((m) => ({ at: Date.parse(m.startsAt), upcoming: m.upcoming, live: m.live, finished: m.finished }))
    .filter((m) => Number.isFinite(m.at))
    .sort((a, b) => a.at - b.at);

  if (!timed.length) {
    return { state: "idle", everyMs: IDLE, reason: "no match times on the page", nextMatchAt: null };
  }

  // Live: the page is carrying a score for a series it has not called
  // finished. Failing that, started recently enough that the page has not
  // clearly stopped being updated for it - which covers a match that has
  // begun before anyone has entered a game score.
  //
  // The score test has to come first. A series being played has upcoming
  // false, so filtering on that alone dropped every live match out of this
  // list and the collector fell back to the 10-minute event-day cadence at
  // exactly the moment the fast one is worth paying for.
  const live = timed.filter((m) => m.live ||
    (!m.finished && m.upcoming && m.at <= nowMs && nowMs - m.at < ASSUME_LIVE));
  if (live.length) {
    return { state: "live", everyMs: LIVE, reason: `${live.length} match${live.length === 1 ? "" : "es"} under way`, nextMatchAt: null };
  }

  const next = timed.find((m) => m.at > nowMs && m.upcoming);
  if (next) {
    const until = next.at - nowMs;
    if (until <= WARMUP) {
      return { state: "warmup", everyMs: LIVE, reason: `next match in ${Math.round(until / MINUTE)} min`, nextMatchAt: new Date(next.at).toISOString() };
    }
    // Same day as the next match: keep a hand in, so a schedule change or an
    // early start is noticed. Otherwise idle.
    const sameDay = new Date(next.at).toISOString().slice(0, 10) === new Date(nowMs).toISOString().slice(0, 10);
    return {
      state: sameDay ? "event-day" : "idle",
      everyMs: sameDay ? EVENT_DAY : IDLE,
      reason: sameDay ? "matches later today" : `next match ${new Date(next.at).toISOString().slice(0, 10)}`,
      nextMatchAt: new Date(next.at).toISOString(),
    };
  }

  // Everything on the page has been played.
  return { state: "done", everyMs: IDLE, reason: "every match on the page is finished", nextMatchAt: null };
}

/**
 * Requests per hour this plan implies, for one title.
 *
 * Worth asserting in a test rather than reasoning about: the whole risk here
 * is quietly exceeding what the source asks for.
 */
export const perHour = (plan) => Math.round(3600e3 / plan.everyMs);

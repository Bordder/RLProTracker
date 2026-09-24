// Whether an alert that is still true should be posted again.
//
// The scrape-rate alert had no memory, so a fleet that stayed blocked posted
// the same "99% failing" embed, with a ping, on every alerts run: hourly, and
// more often on a day of manual dispatches. From the Season 24 launch on 23
// September 2026 that was a ping an hour for a condition nobody could fix by
// being told again.
//
// So: post when it starts, post again if it gets worse, and otherwise remind
// no more than once every REMIND_MS. State is kept by the workflow in the
// Actions cache (.alert-state/), never in the repo. Pure, for tests.

export const REMIND_MS = 12 * 3600e3;

export function shouldPost(prev, level, now, remindMs = REMIND_MS) {
  if (!prev?.at) return true;
  if (level > (prev.level ?? 0)) return true;
  return now - Date.parse(prev.at) >= remindMs;
}

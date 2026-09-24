// "A LAN is being played", by the same rule as eventRunning in web/fixtures.mjs:
// the published dates padded a day either side, or a match started within the
// last two hours and not finished. Copied rather than imported, because the
// page module carries a cache-bust stamp in its imports that a Worker bundle
// cannot resolve; test/worker-bracket-day.test.mjs holds the two together.
//
// It used to be the UTC date inside the published dates. Those are the venue's
// dates, so a North American grand final that runs past midnight UTC dropped
// this to the slow cadence for its last hours, and the bracket lagged the
// final by up to half an hour.
const DAY_MS = 86400e3;
const LIVE_MS = 2 * 3600e3;
export function lanRunning(doc, nowMs) {
  return (doc?.events || []).some((e) => {
    const from = Date.parse(`${e.starts}T00:00:00Z`) - DAY_MS;
    const to = Date.parse(`${e.ends}T00:00:00Z`) + 2 * DAY_MS;
    if (nowMs >= from && nowMs <= to) return true;
    return (e.stages || []).some((s) =>
      [...(s.brackets || []), ...(s.matchlists || [])].some((g) =>
        (g.matches || []).some((m) => {
          const at = Date.parse(m.startsAt || "");
          return !m.finished && nowMs >= at && nowMs - at < LIVE_MS;
        })));
  });
}

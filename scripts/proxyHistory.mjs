// A rolling 24-hour record of how each proxy actually performed.
//
// data/proxy-use.json holds one run and is overwritten by the next, which is
// the right shape for "what did this run do" and the wrong shape for every
// question worth asking about a proxy. A single run at the 2-minute cadence
// gives a proxy about three attempts, so one bad patch reads as 100% failure
// and one lucky patch reads as perfect. On 2026-09-10 that difference mattered:
// a single snapshot said three proxies were dead, and fifteen consecutive runs
// said five were, which was also what the probe had been reporting all along.
//
// So keep a small archive. Not a file per run - the collector runs every two
// minutes and this branch already carries about 1,400 commits a day - but
// hourly buckets, updated in place. Twenty-four buckets of three integers per
// proxy is a couple of KB that delta-compresses to almost nothing, and it
// answers the only question anyone asks: over the last day, how often did this
// address fail, and was it benched while doing it.
//
// Indices only, never addresses: this file is committed to a public repo.

export const HOUR = 3600e3;
export const WINDOW_MS = 24 * HOUR;

// A proxy needs this many attempts in the window before its rate means
// anything. Ten is roughly three runs' worth: enough that a single bad patch
// cannot condemn an address, small enough that a genuinely dead one is named
// within the hour rather than tomorrow.
export const MIN_ATTEMPTS = 10;
// Failure rates worth acting on. Dead is "replace it"; bad is "watch it, and
// replace it if it stays here". Both are well clear of the fleet's ordinary
// 20-30% background rate, which is what scraping tracker.gg costs even when
// every address is healthy.
export const DEAD_RATE = 0.8;
export const BAD_RATE = 0.45;
// Benching hides the thing the rate is trying to measure. When failures look
// like the tunnel's own, the collector drops that index from the rotation
// part-way through the run, so it stops accumulating the attempts it would
// have failed - and its failure rate comes out LOWER the worse it behaves.
// Measured 2026-09-10: index 5 was benched in 11 of 15 runs and still scored
// 36%, which reads as healthy beside a fleet background of 20-30%. So how
// often an index gets benched is its own signal, independent of the rate.
export const DEAD_BENCH = 0.8;
export const BAD_BENCH = 0.5;
// A verdict needs enough RUNS behind it as well as enough attempts, and this
// applies to the failure rate exactly as much as to the bench ratio.
//
// Both halves of that were learned the hard way within an hour of the history
// going live. First a proxy benched in 1 of 1 runs scored a 100% bench rate
// and was called dead at 20% failure. Then, with the window three runs old,
// the busiest proxy on the fleet reached 12 attempts and was condemned at
// "100% of 12" - twelve minutes of evidence against the 2% of 128 it had
// managed the day before. Attempts accumulate fast enough to clear
// MIN_ATTEMPTS inside a few minutes, so attempts alone cannot stand in for
// elapsed time. Five runs is roughly fifteen minutes at the 3-minute cadence.
export const MIN_RUNS = 5;

const hourKey = (ms) => new Date(Math.floor(ms / HOUR) * HOUR).toISOString();

/**
 * Fold one run's proxy-use figures into the rolling history.
 *
 * Pure: takes the previous history and returns a new one, so the caller owns
 * reading and writing and this stays testable.
 *
 * @param history previous file contents, or null/garbage on the first run
 * @param run     the object written to data/proxy-use.json this run
 * @param nowMs   run timestamp; defaults to run.at, then to the clock
 */
export function recordRun(history, run, nowMs) {
  const at = Number.isFinite(nowMs) ? nowMs : Date.parse(run?.at ?? "") || Date.now();
  const use = Array.isArray(run?.use) ? run.use : [];

  const prev = Array.isArray(history?.hours) ? history.hours : [];
  const key = hourKey(at);
  const hours = prev.filter((h) => h && typeof h.h === "string");

  let bucket = hours.find((h) => h.h === key);
  if (!bucket) {
    bucket = { h: key, runs: 0, use: [] };
    hours.push(bucket);
  }
  bucket.runs += 1;

  for (const u of use) {
    const i = Number(u?.i);
    if (!Number.isInteger(i) || i < 0 || i > 255) continue;
    // [attempts, fails, runs-in-which-it-was-benched]
    while (bucket.use.length <= i) bucket.use.push([0, 0, 0]);
    const cell = bucket.use[i];
    cell[0] += Number(u.attempts) || 0;
    cell[1] += Number(u.fails) || 0;
    if (u.benched) cell[2] += 1;
  }

  // Drop whole buckets that have fallen out of the window. Keeping the current
  // hour means the window is 24 to 25 hours wide depending on when this runs,
  // which is fine: nothing here is a measurement of exactly one day.
  const cutoff = at - WINDOW_MS;
  const kept = hours
    .filter((h) => Date.parse(h.h) >= cutoff)
    .sort((a, b) => Date.parse(a.h) - Date.parse(b.h));

  return {
    updatedAt: new Date(at).toISOString(),
    windowHours: WINDOW_MS / HOUR,
    proxyCount: Number(run?.proxyCount) || kept.reduce((n, h) => Math.max(n, h.use.length), 0),
    note: "Rolling per-proxy attempts/fails/benched, bucketed by hour. Indices match PROXY_LIST and data/proxy-use.json.",
    hours: kept,
  };
}

/**
 * Totals per proxy index across the whole window, worst first.
 *
 * `state` is the judgement the alert acts on:
 *   dead      - sustained failure, replace it
 *   bad       - failing far more than the fleet's background rate
 *   ok        - working
 *   unproven  - too few attempts in the window to say anything
 */
export function summarise(history) {
  // Tolerate a truncated or hand-edited file. This is read by an alert, and an
  // alert that throws on malformed input is an alert that goes quiet exactly
  // when something upstream has gone wrong.
  const hours = (Array.isArray(history?.hours) ? history.hours : [])
    .filter((h) => h && typeof h === "object" && Array.isArray(h.use));
  const width = hours.reduce((n, h) => Math.max(n, h.use.length), 0);
  const runs = hours.reduce((n, h) => n + (Number(h.runs) || 0), 0);

  const out = [];
  for (let i = 0; i < width; i++) {
    let attempts = 0, fails = 0, benched = 0;
    for (const h of hours) {
      const cell = h.use[i];
      if (!cell) continue;
      attempts += Number(cell[0]) || 0;
      fails += Number(cell[1]) || 0;
      benched += Number(cell[2]) || 0;
    }
    const rate = attempts ? fails / attempts : 0;
    const benchRate = runs ? benched / runs : 0;
    const state =
      attempts < MIN_ATTEMPTS || runs < MIN_RUNS ? "unproven"
      : rate >= DEAD_RATE || benchRate >= DEAD_BENCH ? "dead"
      : rate >= BAD_RATE || benchRate >= BAD_BENCH ? "bad"
      : "ok";
    out.push({ i, attempts, fails, benched, benchRate, rate, state });
  }

  const rank = { dead: 0, bad: 1, unproven: 2, ok: 3 };
  out.sort((a, b) => rank[a.state] - rank[b.state] || b.rate - a.rate || b.benchRate - a.benchRate || a.i - b.i);
  return { runs, hours: hours.length, proxies: width, rows: out };
}

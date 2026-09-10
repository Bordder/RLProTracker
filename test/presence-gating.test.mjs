// Presence gating: a player Steam reports as NOT in Rocket League is deferred
// rather than scraped every run.
//
// Added 2026-09-10. tracker.gg rate-limits per IP, and the fleet had reached
// 89% failure with 14 of 15 proxies refused. Cutting requests per IP is the fix
// that does not expire, unlike replacing addresses. The correctness argument is
// that matchesPlayed is cumulative, so a deferred scrape still captures every
// game: nothing is lost, only delayed.
import test from "node:test";
import assert from "node:assert/strict";
import { selectDue } from "../scripts/fetchTracker.mjs";

const roster = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `p${i}` }));
const prio = { defaultHours: 0.025, perRun: 150, idleMultiplier: 10, hotIntervalMinutes: 20 };
const NOW = Date.parse("2026-09-10T20:00:00Z");
const ago = (mins) => new Date(NOW - mins * 60e3).toISOString();

test("a player Steam reports as out is not due every run", () => {
  const players = roster(1);
  const busy = selectDue(players, prio, { p0: { last: ago(2) } }, NOW);
  const idle = selectDue(players, prio, { p0: { last: ago(2), presence: "out" } }, NOW);
  assert.equal(busy.length, 1, "with no presence signal the player is due");
  assert.equal(idle.length, 0, "reported out, two minutes is not enough");
});

test("an out player is still scraped once the stretched interval passes", () => {
  const players = roster(1);
  // 0.025h = 90s, times 10 = 15 minutes. Nothing is dropped, only deferred.
  const later = selectDue(players, prio, { p0: { last: ago(30), presence: "out" } }, NOW);
  assert.equal(later.length, 1, "half an hour later they are due again");
});

test("hot beats out: a player who starts playing is picked up immediately", () => {
  const players = roster(1);
  // presenceHot sets hot on an in-game read, and hot is checked first, so a
  // stale "out" from a previous poll cannot hold back someone who just queued.
  const hot = selectDue(players, prio, { p0: { last: ago(2), presence: "out", hot: true } }, NOW);
  assert.equal(hot.length, 1);
});

test("unknown presence is left alone", () => {
  // About half the roster is private or hidden-details and reports "unknown".
  // Presence proves nothing for them, so they must keep full cadence.
  const players = roster(1);
  for (const presence of ["unknown", undefined]) {
    const got = selectDue(players, prio, { p0: { last: ago(2), presence } }, NOW);
    assert.equal(got.length, 1, `presence=${presence} must not be gated`);
  }
});

test("gating is off unless configured", () => {
  const players = roster(1);
  const off = selectDue(players, { ...prio, idleMultiplier: undefined }, { p0: { last: ago(2), presence: "out" } }, NOW);
  assert.equal(off.length, 1, "with no idleMultiplier the default of 1 changes nothing");
});

test("a never-scraped player is always due, whatever presence says", () => {
  const players = roster(1);
  const fresh = selectDue(players, prio, { p0: { presence: "out" } }, NOW);
  assert.equal(fresh.length, 1, "no reading yet means scrape now");
});

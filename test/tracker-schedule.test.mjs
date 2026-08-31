// Unit tests for the tracker scheduler (playerRanks + selectDue). Pure logic:
// selectDue takes `now` as an argument, so no clock/Date dependence here.
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectDue, playerRanks, RUN_SPACING_MS } from "../scripts/fetchTracker.mjs";

const HOUR = 3600e3;
const ids = (players) => players.map((p) => p.id).sort();

// N players all on the same interval (default 1h), ids t-00..t-0(N-1)
function roster(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `t-${String(i).padStart(2, "0")}`, name: `P${i}`, team: "T", steamId64: `${i}` }));
}
const prio = (perRun = 100, hours = 1) => ({ perRun, defaultHours: hours, players: {} });
const iso = (ms) => new Date(ms).toISOString();

test("playerRanks assigns sequential ranks within an interval group by sorted id", () => {
  const players = roster(4);
  const ranks = playerRanks(players, prio());
  assert.equal(ranks.get("t-00"), 0);
  assert.equal(ranks.get("t-01"), 1);
  assert.equal(ranks.get("t-02"), 2);
  assert.equal(ranks.get("t-03"), 3);
});

test("never-fetched players are all due regardless of slot (initial fill)", () => {
  const players = roster(6);
  const now = RUN_SPACING_MS * 1000; // arbitrary aligned time
  const due = selectDue(players, prio(), {}, now); // empty state = never fetched
  assert.equal(due.length, 6);
});

test("a recently-fetched player (elapsed < interval) is not due", () => {
  const players = roster(3);
  const now = RUN_SPACING_MS * 1000;
  const state = Object.fromEntries(players.map((p) => [p.id, { last: iso(now - 10 * 60e3), fails: 0 }])); // 10 min ago
  const due = selectDue(players, prio(), state, now);
  assert.equal(due.length, 0); // all fetched 10 min ago, 1h interval not elapsed
});

test("slot gating: among due players, exactly the current-slot ranks are selected", () => {
  const players = roster(6); // ranks 0..5, slots = round(1h / 20min) = 3 -> slot = rank % 3
  const now = RUN_SPACING_MS * 1000; // floor(now/RUN) = 1000; curSlot = 1000 % 3 = 1
  const curSlot = Math.floor(now / RUN_SPACING_MS) % 3;
  const state = Object.fromEntries(players.map((p) => [p.id, { last: iso(now - 2 * HOUR), fails: 0 }])); // elapsed 2h >= 1h
  const due = selectDue(players, prio(), state, now);
  const ranks = playerRanks(players, prio());
  const expected = players.filter((p) => ranks.get(p.id) % 3 === curSlot).map((p) => p.id).sort();
  assert.deepEqual(ids(due), expected);
  assert.ok(due.length > 0 && due.length < 6); // genuinely spread, not all-or-nothing
});

test("perRun caps the number selected", () => {
  const players = roster(20);
  const now = RUN_SPACING_MS * 1000;
  const due = selectDue(players, prio(3), {}, now); // 20 never-fetched, perRun 3
  assert.equal(due.length, 3);
});

test("a hot player refreshes on the fast interval, not the slow base one", () => {
  const players = roster(1); // t-00, 1h base interval
  const now = RUN_SPACING_MS * 1000;
  const last = iso(now - 25 * 60e3); // 25 min ago: past the 20m hot interval, short of 1h
  // not hot -> 1h interval not elapsed -> not due
  assert.equal(selectDue(players, prio(), { "t-00": { last, fails: 0 } }, now).length, 0);
  // hot -> ~20m interval, 25m elapsed -> due
  assert.equal(selectDue(players, prio(), { "t-00": { last, fails: 0, hot: true } }, now).length, 1);
});

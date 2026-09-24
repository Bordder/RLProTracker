// Unit tests for the tracker scheduler (playerRanks + selectDue). Pure logic:
// selectDue takes `now` as an argument, so no clock/Date dependence here.
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectDue, playerRanks, RUN_SPACING_MS, nextActivity } from "../scripts/fetchTracker.mjs";

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
  const players = roster(6); // slots = round(1h / RUN_SPACING_MS) -> slot = rank % slots
  const slots = Math.max(1, Math.round(HOUR / RUN_SPACING_MS));
  // Land on slot 1 whatever the run spacing is, so that at least one of the six
  // ranks matches and the selection is a genuine subset rather than empty.
  const curSlot = 1 % slots;
  const now = RUN_SPACING_MS * (slots * 50 + curSlot);
  const state = Object.fromEntries(players.map((p) => [p.id, { last: iso(now - 2 * HOUR), fails: 0 }])); // elapsed 2h >= 1h
  const due = selectDue(players, prio(), state, now);
  const ranks = playerRanks(players, prio());
  const expected = players.filter((p) => ranks.get(p.id) % slots === curSlot).map((p) => p.id).sort();
  assert.deepEqual(ids(due), expected);
  assert.ok(due.length > 0 && due.length < 6); // genuinely spread, not all-or-nothing
});

test("perRun caps the number selected", () => {
  const players = roster(20);
  const now = RUN_SPACING_MS * 1000;
  const due = selectDue(players, prio(3), {}, now); // 20 never-fetched, perRun 3
  assert.equal(due.length, 3);
});

test("nextActivity: full hot/cool lifecycle over a session", () => {
  // first scrape ever: just records the count, not hot
  let s = nextActivity({}, 100);
  assert.deepEqual(s, { matches: 100, hot: false, idle: 1 });
  // plays 4 games since last scrape (>= threshold 3) -> HOT
  s = nextActivity(s, 104);
  assert.deepEqual(s, { matches: 104, hot: true, idle: 0 });
  // one more game -> stays hot, idle reset
  s = nextActivity(s, 105);
  assert.deepEqual(s, { matches: 105, hot: true, idle: 0 });
  // no new games (between games / stopped) -> still hot, idle 1 (grace)
  s = nextActivity(s, 105);
  assert.deepEqual(s, { matches: 105, hot: true, idle: 1 });
  // still no new games -> idle hits COOL_AFTER (2) -> cools off
  s = nextActivity(s, 105);
  assert.deepEqual(s, { matches: 105, hot: false, idle: 2 });
});

test("nextActivity: a jump of >= 2 games flips a cold player hot", () => {
  const s = nextActivity({ matches: 200, hot: false, idle: 3 }, 202); // +2 games
  assert.equal(s.hot, true);
  assert.equal(s.idle, 0);
});

test("nextActivity: a single new game does not flip hot (below threshold)", () => {
  const s = nextActivity({ matches: 200, hot: false, idle: 1 }, 201); // +1 game
  assert.equal(s.hot, false);
  assert.equal(s.idle, 0); // activity still resets the idle counter
});

test("a hot player refreshes on the fast interval, not the slow base one", () => {
  // Checked across a full cycle of runs rather than at one instant. Players are
  // spread over slots so that same-interval players do not all come due at
  // once, which means "is it due right now" depends on where the clock happens
  // to fall - and that made this test fail purely because the run spacing
  // changed from five minutes to three.
  const players = roster(1); // t-00, 1h base interval
  const start = RUN_SPACING_MS * 1000;
  const last = iso(start - 25 * 60e3); // 25 min ago: past the 20m hot interval, short of 1h
  // Ten runs is 30 minutes at the current spacing: comfortably past the 20
  // minute hot interval, comfortably short of the 1 hour base one.
  const RUNS = Math.floor(30 * 60e3 / RUN_SPACING_MS);
  let coldDue = 0, hotDue = 0;
  for (let i = 0; i < RUNS; i++) {
    const now = start + i * RUN_SPACING_MS;
    coldDue += selectDue(players, prio(), { "t-00": { last, fails: 0 } }, now).length;
    hotDue += selectDue(players, prio(), { "t-00": { last, fails: 0, hot: true } }, now).length;
  }
  assert.equal(coldDue, 0, "an hour has not elapsed, so the cold player is never due");
  assert.ok(hotDue > 0, "the hot player comes due within a cycle");
});

// ---- who is scraped, and in what order -------------------------------------

// The live interval (data/priorities.json) is deliberately shorter than the
// run spacing, which gives one slot and makes every player due every run. That
// is the arrangement these two tests are about, so they use it rather than the
// hour-long default the slot tests above need.
const fast = (perRun = 100) => ({ perRun, defaultHours: 0.025, players: {} });

test("in-game players are scraped last, against the same publish", () => {
  // A run takes longer than the interval between runs and publishes only at
  // the end, so a reading taken first is already minutes old when it ships.
  // The players who can be finishing a match are the ones that costs.
  const players = roster(6);
  const now = RUN_SPACING_MS * 1000;
  const state = {};
  for (const p of players) state[p.id] = { last: iso(now - 2 * HOUR) };
  state["t-01"].presence = "in";
  state["t-04"].hot = true;

  const order = selectDue(players, fast(), state, now).map((p) => p.id);
  assert.equal(order.length, 6);
  assert.deepEqual(order.slice(-2).sort(), ["t-01", "t-04"]);
});

test("ordering does not change who is selected when the ceiling binds", () => {
  // The ceiling is shared out most-overdue-first, and reordering the result
  // must not quietly let an in-game player take somebody else's place.
  const players = roster(6);
  const now = RUN_SPACING_MS * 1000;
  const state = {};
  players.forEach((p, i) => { state[p.id] = { last: iso(now - (i + 2) * HOUR) }; });
  state["t-00"].presence = "in"; // the LEAST overdue of the six

  const picked = selectDue(players, fast(3), state, now).map((p) => p.id);
  assert.deepEqual(picked.sort(), ["t-03", "t-04", "t-05"]);
});

// ---- Low 21 / L-test-3: idle players and their slots -----------------------
//
// The tests above use elapsed times far past the interval, so the slot delay
// never showed. These sit right on the interval boundary, and then run the
// scheduler against runs spaced the way they really are (120 to 200 seconds,
// not the 120 the slots assume).

const IDLE_PRIO = { perRun: 150, defaultHours: 0.025, idleMultiplier: 10, hotIntervalMinutes: 2, players: {} };
const IDLE_MS = 0.025 * HOUR * 10; // 15 minutes

test("an idle player is due once its interval has passed, whatever its slot", () => {
  const players = roster(8); // eight idle players share eight slots, one each
  const now = RUN_SPACING_MS * 1000 + 30e3;
  // Everyone else was read this run's predecessor, so there is an allowance.
  const at = (ms) => ({ last: iso(ms), fails: 0, presence: "out" });
  for (const p of players) {
    const state = Object.fromEntries(players.map((q) => [q.id, at(now - 60e3)]));
    state[p.id] = at(now - IDLE_MS);
    assert.deepEqual(ids(selectDue(players, IDLE_PRIO, state, now)), [p.id], `${p.id} at exactly its interval`);
    state[p.id] = at(now - IDLE_MS + 1000);
    assert.deepEqual(selectDue(players, IDLE_PRIO, state, now), [], `${p.id} a second short`);
  }
});

test("a player who is not idle still waits for its slot", () => {
  const players = roster(8);
  const prio = { perRun: 150, defaultHours: 0.25, players: {} }; // 15 minutes, 8 slots
  const now = RUN_SPACING_MS * 1000; // slot 1000 % 8 = 0
  const state = Object.fromEntries(players.map((p) => [p.id, { last: iso(now - 0.25 * HOUR), fails: 0 }]));
  assert.deepEqual(ids(selectDue(players, prio, state, now)), ["t-00"]);
});

function simulate(n, hours, seed = 7) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const players = roster(n);
  const t0 = Date.UTC(2026, 8, 20);
  const state = {};
  const reads = {};
  for (const p of players) {
    const last = t0 - Math.floor(rnd() * IDLE_MS);
    state[p.id] = { last: iso(last), fails: 0, presence: "out" };
    reads[p.id] = [last];
  }
  const runs = [];
  let t = t0, prev = Math.max(...Object.values(reads).map((r) => r[0]));
  while (t < t0 + hours * HOUR) {
    t += 120e3 + Math.floor(rnd() * 80e3);
    const due = selectDue(players, IDLE_PRIO, state, t);
    runs.push({ t, prev, count: due.length });
    for (const p of due) { state[p.id].last = iso(t); reads[p.id].push(t); }
    if (due.length) prev = t;
  }
  const gaps = Object.values(reads).flatMap((r) => r.slice(1).map((x, i) => ({ from: r[i], gap: x - r[i] })));
  return { t0, runs, gaps, reads };
}

test("idle players are read on time against real run spacing, never early", () => {
  const { t0, gaps } = simulate(40, 48);
  const warm = gaps.filter((g) => g.from > t0 + HOUR).map((g) => g.gap);
  // Never more often than the interval.
  assert.ok(Math.min(...gaps.map((g) => g.gap)) >= IDLE_MS);
  // And promptly after it: within two run gaps (200s each at most). The slot
  // rule this replaces left gaps of up to 97 minutes here.
  assert.ok(Math.max(...warm) <= IDLE_MS + 2 * 200e3, `max gap ${Math.max(...warm) / 1e3}s`);
});

test("no run reads more idle players than their intervals allow", () => {
  const n = 40;
  const { t0, runs, reads } = simulate(n, 48);
  for (const r of runs) {
    // What the intervals earn between the previous read and this run.
    const allow = Math.ceil((n * Math.min(r.t - r.prev, IDLE_MS)) / IDLE_MS - 1e-9);
    assert.ok(r.count <= allow, `${r.count} read at ${iso(r.t)} against ${allow} allowed`);
  }
  // And over the whole window, no more than once per interval each.
  const end = runs.at(-1).t;
  const total = Object.values(reads).reduce((sum, r) => sum + r.length - 1, 0);
  assert.ok(total <= n * (Math.floor((end - t0) / IDLE_MS) + 1));
  // They stay spread: nothing herds everyone into one run.
  assert.ok(Math.max(...runs.map((r) => r.count)) < n / 2);
});

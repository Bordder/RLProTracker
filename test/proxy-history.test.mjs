// The bug these exist for: on 2026-09-10 a single proxy-use.json snapshot was
// read as the fleet's condition and it disagreed with fifteen consecutive runs
// of the same data. Three attempts per proxy is not a sample. Everything below
// asserts that a judgement needs enough attempts behind it, and that the window
// does not grow without bound.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordRun, summarise, HOUR, WINDOW_MS, MIN_ATTEMPTS } from "../scripts/proxyHistory.mjs";

const T0 = Date.parse("2026-09-10T12:00:00.000Z");
const run = (use, at) => ({ at: new Date(at).toISOString(), proxyCount: use.length, use: use.map((u, i) => ({ i, ...u })) });
const rowsBy = (s) => Object.fromEntries(s.rows.map((r) => [r.i, r]));

test("a first run against no history starts a bucket", () => {
  const h = recordRun(null, run([{ attempts: 4, fails: 1 }, { attempts: 4, fails: 0 }], T0), T0);
  assert.equal(h.hours.length, 1);
  assert.equal(h.hours[0].runs, 1);
  assert.deepEqual(h.hours[0].use[0], [4, 1, 0]);
});

test("runs inside one hour accumulate into the same bucket", () => {
  let h = null;
  for (let n = 0; n < 5; n++) h = recordRun(h, run([{ attempts: 3, fails: 3 }], T0 + n * 60e3), T0 + n * 60e3);
  assert.equal(h.hours.length, 1, "five runs in one hour is one bucket");
  assert.equal(h.hours[0].runs, 5);
  assert.deepEqual(h.hours[0].use[0], [15, 15, 0]);
});

test("a benched run is counted once, not once per attempt", () => {
  let h = recordRun(null, run([{ attempts: 3, fails: 3, benched: true }], T0), T0);
  h = recordRun(h, run([{ attempts: 3, fails: 3, benched: true }], T0 + 60e3), T0 + 60e3);
  assert.equal(h.hours[0].use[0][2], 2);
});

test("buckets older than the window are dropped", () => {
  let h = recordRun(null, run([{ attempts: 5, fails: 0 }], T0), T0);
  const later = T0 + WINDOW_MS + HOUR;
  h = recordRun(h, run([{ attempts: 5, fails: 0 }], later), later);
  assert.equal(h.hours.length, 1, "the day-old bucket should be gone");
  assert.equal(h.hours[0].h, new Date(Math.floor(later / HOUR) * HOUR).toISOString());
});

test("the window never holds more than about a day of buckets", () => {
  let h = null;
  for (let n = 0; n < 100; n++) {
    const at = T0 + n * HOUR;
    h = recordRun(h, run([{ attempts: 1, fails: 0 }], at), at);
  }
  assert.ok(h.hours.length <= 25, `unbounded growth: ${h.hours.length} buckets`);
});

test("too few attempts is 'unproven', not 'dead'", () => {
  // The exact shape of the 10 September mistake: three attempts, all failed.
  const h = recordRun(null, run([{ attempts: 3, fails: 3, benched: true }], T0), T0);
  const r = rowsBy(summarise(h));
  assert.equal(r[0].state, "unproven");
  assert.ok(r[0].attempts < MIN_ATTEMPTS);
});

test("sustained failure across runs is 'dead'", () => {
  let h = null;
  for (let n = 0; n < 15; n++) {
    const at = T0 + n * 2 * 60e3;
    h = recordRun(h, run([{ attempts: 3, fails: 3, benched: true }, { attempts: 8, fails: 1 }], at), at);
  }
  const r = rowsBy(summarise(h));
  assert.equal(r[0].state, "dead", `45 attempts all failed should be dead, got ${r[0].rate}`);
  assert.equal(r[1].state, "ok");
});

test("the fleet's ordinary background failure rate is not called bad", () => {
  // ~28% is what a healthy fleet measured at, so it must not trip anything.
  let h = null;
  for (let n = 0; n < 20; n++) {
    const at = T0 + n * 2 * 60e3;
    h = recordRun(h, run([{ attempts: 10, fails: 3 }], at), at);
  }
  assert.equal(rowsBy(summarise(h))[0].state, "ok");
});

test("worst proxies sort first", () => {
  let h = null;
  for (let n = 0; n < 10; n++) {
    const at = T0 + n * 2 * 60e3;
    h = recordRun(h, run([{ attempts: 5, fails: 0 }, { attempts: 5, fails: 5 }, { attempts: 5, fails: 3 }], at), at);
  }
  const s = summarise(h);
  assert.deepEqual(s.rows.map((r) => r.i), [1, 2, 0]);
  assert.equal(s.rows[0].state, "dead");
  assert.equal(s.rows[1].state, "bad");
});

test("a corrupt or empty history does not throw", () => {
  for (const junk of [null, undefined, {}, { hours: "nope" }, { hours: [null, 3] }]) {
    const h = recordRun(junk, run([{ attempts: 1, fails: 0 }], T0), T0);
    assert.equal(h.hours.length, 1);
    assert.doesNotThrow(() => summarise(junk));
  }
  assert.deepEqual(summarise(null).rows, []);
});

test("a proxy list that grows mid-window is summarised over the wider shape", () => {
  let h = recordRun(null, run([{ attempts: 5, fails: 0 }], T0), T0);
  const later = T0 + HOUR;
  h = recordRun(h, run([{ attempts: 5, fails: 0 }, { attempts: 5, fails: 5 }], later), later);
  const s = summarise(h);
  assert.equal(s.proxies, 2);
  assert.equal(rowsBy(s)[0].attempts, 10);
  assert.equal(rowsBy(s)[1].attempts, 5);
});

test("a proxy benched in most runs is not 'ok', however good its rate looks", () => {
  // Index 5 on 2026-09-10: benched 11 of 15 runs, and 36% failure because
  // benching stopped it accumulating the attempts it would have failed.
  let h = null;
  for (let n = 0; n < 15; n++) {
    const at = T0 + n * 2 * 60e3;
    h = recordRun(h, run([{ attempts: 7, fails: 3, benched: n < 11 }], at), at);
  }
  const r = rowsBy(summarise(h))[0];
  assert.ok(r.rate < 0.45, `rate should look healthy: ${r.rate}`);
  // "bad" rather than "dead" on purpose: benched in 73% of runs is severe, but
  // it still contributed real attempts, so it earns a watch and not a spend.
  assert.equal(r.state, "bad", "benched in 11 of 15 runs is not ok");
});

test("a proxy benched in nearly every run is 'dead'", () => {
  let h = null;
  for (let n = 0; n < 15; n++) {
    const at = T0 + n * 2 * 60e3;
    h = recordRun(h, run([{ attempts: 7, fails: 3, benched: n < 14 }], at), at);
  }
  assert.equal(rowsBy(summarise(h))[0].state, "dead");
});

test("occasional benching on an otherwise healthy proxy stays 'ok'", () => {
  let h = null;
  for (let n = 0; n < 15; n++) {
    const at = T0 + n * 2 * 60e3;
    h = recordRun(h, run([{ attempts: 10, fails: 1, benched: n < 3 }], at), at);
  }
  assert.equal(rowsBy(summarise(h))[0].state, "ok");
});

test("one run cannot condemn a proxy on its bench ratio alone", () => {
  // Live regression, 2026-09-10: with a single run in the window a lone bench
  // is a 100% bench rate, and the report called a proxy failing 20% of its
  // requests dead.
  const h = recordRun(null, run([{ attempts: 15, fails: 3, benched: true }], T0), T0);
  const r = rowsBy(summarise(h))[0];
  assert.equal(r.benched, 1);
  assert.equal(r.state, "ok", "20% failure over one run is not dead");
});

test("the bench signal switches on once there are enough runs", () => {
  let h = null;
  for (let n = 0; n < 6; n++) {
    const at = T0 + n * 2 * 60e3;
    h = recordRun(h, run([{ attempts: 15, fails: 3, benched: true }], at), at);
  }
  assert.equal(rowsBy(summarise(h))[0].state, "dead");
});

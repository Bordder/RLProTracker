// The proxy rotation was wrong for weeks and nothing surfaced it: every scrape
// succeeded, and the only symptom was one pool of five carrying 86 GB while ten
// others carried 15 GB between them. These tests assert the property that
// actually matters, which is that work spreads evenly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { proxyIndexFor, weightedOrder } from "../scripts/fetchTracker.mjs";

test("a full roster spreads evenly across every proxy", () => {
  const COUNT = 15, PLAYERS = 60;
  const hits = new Array(COUNT).fill(0);
  for (let player = 0; player < PLAYERS; player++) hits[proxyIndexFor(0, player, COUNT)]++;
  assert.equal(hits.reduce((a, b) => a + b, 0), PLAYERS);
  // 60 players over 15 proxies is exactly 4 each; nothing may be starved or
  // overloaded, which is the failure this replaces.
  assert.ok(Math.min(...hits) === 4 && Math.max(...hits) === 4, `uneven: ${hits}`);
});

test("no proxy sits idle while others take the load", () => {
  const COUNT = 15;
  const used = new Set();
  for (let player = 0; player < COUNT; player++) used.add(proxyIndexFor(0, player, COUNT));
  assert.equal(used.size, COUNT);
});

test("retries move to a different proxy each time", () => {
  const COUNT = 15, start = 7;
  const seen = [0, 1, 2, 3, 4].map((a) => proxyIndexFor(a, start, COUNT));
  assert.equal(new Set(seen).size, seen.length, `repeat within one player: ${seen}`);
});

test("rotation wraps rather than running off the end", () => {
  assert.equal(proxyIndexFor(3, 14, 15), 2);
  assert.equal(proxyIndexFor(0, 0, 1), 0); // single proxy, or none configured
});

// Weights exist because even is not always right: two pools with different
// caps should not take equal shares, or the smaller cap runs out first.
test("weightedOrder: equal weights give one slot each, in order", () => {
  assert.deepEqual(weightedOrder([1, 1, 1, 1]), [0, 1, 2, 3]);
});

test("weightedOrder: a heavier proxy takes proportionally more of the work", () => {
  const order = weightedOrder([1, 2, 2]);
  const share = (i) => order.filter((x) => x === i).length;
  assert.equal(order.length, 5);
  assert.deepEqual([share(0), share(1), share(2)], [1, 2, 2]);
});

test("weightedOrder: extra turns are spread through the rotation, not clustered", () => {
  // Back-to-back turns would hammer one tunnel while the others idle, which is
  // the imbalance these weights exist to avoid.
  assert.deepEqual(weightedOrder([3, 1]), [0, 1, 0, 0]);
});

test("weightedOrder: a zero weight retires one proxy and leaves the others addressed as before", () => {
  const order = weightedOrder([1, 0, 1]);
  assert.deepEqual(order, [0, 2]);
});

test("weightedOrder: all-zero weights fall back to equal shares rather than no proxies", () => {
  assert.deepEqual(weightedOrder([0, 0, 0]), [0, 1, 2]);
});

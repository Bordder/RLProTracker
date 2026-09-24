// The proxy rotation was wrong for weeks and nothing surfaced it: every scrape
// succeeded, and the only symptom was one pool of five carrying 86 GB while ten
// others carried 15 GB between them. These tests assert the property that
// actually matters, which is that work spreads evenly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { proxyIndexFor, weightedOrder, proxyHealth, isProxyFault, attemptOrder } from "../scripts/fetchTracker.mjs";

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

// ---- benching a proxy that is failing on its own account -------------------

test("isProxyFault blames the tunnel for refused connections and 403s", () => {
  for (const m of ["api-403", "api-429", "api-503", "net::ERR_TUNNEL_CONNECTION_FAILED",
                   "page.goto: net::ERR_PROXY_CONNECTION_FAILED", "socket hang up",
                   "ECONNRESET", "Timeout 45000ms exceeded"]) {
    assert.equal(isProxyFault(new Error(m)), true, m);
  }
});

test("isProxyFault blames the profile for a bad id or a bad body", () => {
  for (const m of ["api-404", "api-400", "api-bad-json", "no-playlists", "no-data"]) {
    assert.equal(isProxyFault(new Error(m)), false, m);
  }
});

test("isProxyFault never blames a proxy for the browser dying", () => {
  // Benching on these would empty the rotation one context at a time.
  assert.equal(isProxyFault(new Error("Target closed")), false);
  assert.equal(isProxyFault(new Error("Timeout: browser has been closed")), false);
});

test("three connection failures in a row bench the proxy, two do not", () => {
  const h = proxyHealth(15);
  const boom = new Error("net::ERR_TUNNEL_CONNECTION_FAILED");
  assert.equal(h.fail(8, boom), false);
  assert.equal(h.fail(8, boom), false);
  assert.equal(h.isBenched(8), false);
  assert.equal(h.fail(8, boom), true);
  assert.equal(h.isBenched(8), true);
  // and nobody else is touched
  assert.equal([...h.benched].join(), "8");
});

test("a success clears the streak, so an occasional stumble never benches", () => {
  const h = proxyHealth(15);
  const boom = new Error("ECONNRESET");
  for (let i = 0; i < 10; i++) { h.fail(3, boom); h.fail(3, boom); h.ok(3); }
  assert.equal(h.isBenched(3), false);
});

test("bad player ids in a row do not bench a healthy proxy", () => {
  // The failure mode this guards: a wrong Epic name 404s on every proxy, so
  // counting it against them would bench the whole rotation player by player.
  const h = proxyHealth(15);
  for (let i = 0; i < 10; i++) h.fail(2, new Error("api-404"));
  assert.equal(h.isBenched(2), false);
});

test("a profile failure between connection failures resets the streak", () => {
  const h = proxyHealth(15);
  h.fail(1, new Error("ECONNRESET"));
  h.fail(1, new Error("ECONNRESET"));
  h.fail(1, new Error("api-404"));          // proved the tunnel works
  h.fail(1, new Error("ECONNRESET"));
  assert.equal(h.isBenched(1), false);
});

test("benching stops before the rotation is emptied", () => {
  // Everything failing at once is tracker.gg being down, not fifteen dead
  // tunnels, and a run with no proxies left collects nothing at all.
  const h = proxyHealth(4);
  const boom = new Error("net::ERR_TUNNEL_CONNECTION_FAILED");
  for (let round = 0; round < 5; round++) for (let i = 0; i < 4; i++) h.fail(i, boom);
  assert.equal(h.benched.size, 2);
  assert.equal(4 - h.benched.size, 2);
});

test("the bench holds nothing across runs", () => {
  // Deliberately per run: an IP refused now is usually fine an hour later.
  assert.equal(proxyHealth(15).benched.size, 0);
});

test("attemptOrder: with nothing benched, behaviour is the old rotation", () => {
  const order = [0, 1, 2, 3, 4];
  assert.deepEqual(attemptOrder(order, 3, 5), [3, 4, 0, 1, 2]);
  assert.deepEqual(attemptOrder(order, 0, 3), [0, 1, 2]);
});

test("attemptOrder: a benched proxy is skipped, and the player still gets its tries", () => {
  const order = [0, 1, 2, 3, 4];
  const plan = attemptOrder(order, 0, 3, (i) => i === 1);
  assert.deepEqual(plan, [0, 2, 3]);
  assert.equal(plan.includes(1), false);
});

test("attemptOrder: never offers the same slot twice, however many are benched", () => {
  const order = [0, 1, 2, 3, 4];
  const plan = attemptOrder(order, 2, 5, (i) => i === 0 || i === 4);
  assert.deepEqual(plan, [2, 3, 1]);
  assert.equal(new Set(plan).size, plan.length);
});

test("attemptOrder: everything benched returns nothing, so the caller can fall back", () => {
  // Falling back to the full rotation matters: a player that gets no attempt at
  // all disappears from the board, which is worse than one tried through a
  // struggling proxy.
  const order = [0, 1, 2];
  assert.deepEqual(attemptOrder(order, 0, 3, () => true), []);
  assert.deepEqual(attemptOrder(order, 0, 3), [0, 1, 2]);
});

test("attemptOrder: weighted rotations keep their shape", () => {
  const order = weightedOrder([1, 2]);   // [0,1,1]
  assert.deepEqual(attemptOrder(order, 0, 3), [0, 1, 1]);
  assert.deepEqual(attemptOrder(order, 0, 3, (i) => i === 1), [0]);
});

test("a dead proxy stops taking work within a few players, and no player is lost", () => {
  // Mirrors scrapePlayer's loop against a fake rotation: proxy 8 refuses every
  // connection, the other fourteen answer. This is the shape of the run measured
  // on 2026-09-04, where index 8 failed 5 of its 6 attempts.
  const COUNT = 15, PLAYERS = 94, TRIES = 5, DEAD = 8;
  const order = weightedOrder(new Array(COUNT).fill(1));
  const health = proxyHealth(COUNT);
  const hits = new Array(COUNT).fill(0);
  let scraped = 0, wasted = 0;

  for (let p = 0; p < PLAYERS; p++) {
    let plan = attemptOrder(order, p, TRIES, (i) => health.isBenched(i));
    if (!plan.length) plan = attemptOrder(order, p, TRIES);
    for (const i of plan) {
      hits[i]++;
      if (i === DEAD) {
        health.fail(i, new Error("net::ERR_TUNNEL_CONNECTION_FAILED"));
        wasted++;
        continue;               // try the next proxy for this player
      }
      health.ok(i);
      scraped++;
      break;
    }
  }

  assert.equal(scraped, PLAYERS, "every player was scraped");
  assert.equal(health.isBenched(DEAD), true, "the dead proxy was benched");
  assert.equal(wasted, 3, "it cost three failed attempts, not one per player it drew");
  assert.equal(hits[DEAD], 3);
  // The work it would have taken went to the others rather than being dropped.
  assert.equal(hits.reduce((a, b) => a + b, 0), PLAYERS + wasted);
});

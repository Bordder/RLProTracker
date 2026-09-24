// Unit tests for the presence-driven hot flag (presenceHot). Pure, no IO.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextPresence, classifyPresence } from "../scripts/presenceHot.mjs";

test("classifyPresence: only public profiles expose game status", () => {
  assert.equal(classifyPresence({ communityvisibilitystate: 3, gameid: "252950" }), "in");
  assert.equal(classifyPresence({ communityvisibilitystate: 3, gameid: "570" }), "out"); // in a different game
  assert.equal(classifyPresence({ communityvisibilitystate: 3 }), "out"); // public, not in a game
  assert.equal(classifyPresence({ communityvisibilitystate: 1, gameid: "252950" }), "unknown"); // private
  assert.equal(classifyPresence(null), "unknown");
});

test("nextPresence: in-game flags hot and resets idle", () => {
  assert.deepEqual(nextPresence({ hot: false, idle: 5 }, "in"), { hot: true, idle: 0, presence: "in" });
});

test("nextPresence: leaving the game cools off after COOL_AFTER checks", () => {
  let s = nextPresence({ hot: true, idle: 0 }, "out"); // 1st not-in-game
  assert.deepEqual(s, { hot: true, idle: 1, presence: "out" }); // grace: still hot
  s = nextPresence(s, "out"); // 2nd not-in-game -> cool
  assert.deepEqual(s, { hot: false, idle: 2, presence: "out" });
});

test("nextPresence: unknown (private) leaves hot/idle untouched for the game-delta fallback", () => {
  assert.deepEqual(nextPresence({ hot: true, idle: 0 }, "unknown"), { hot: true, idle: 0, presence: "unknown" });
  assert.deepEqual(nextPresence({}, "unknown"), { presence: "unknown" });
});

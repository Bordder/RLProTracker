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

// Passed explicitly so these stay pure: the third argument defaults to the
// wall clock, which is fine in the collector and no use in an assertion.
const AT = "2026-09-16T20:00:00.000Z";

test("nextPresence: in-game flags hot and resets idle", () => {
  assert.deepEqual(nextPresence({ hot: false, idle: 5 }, "in", AT), { hot: true, idle: 0, presence: "in", presenceAt: AT });
});

test("nextPresence: leaving the game cools off after COOL_AFTER checks", () => {
  let s = nextPresence({ hot: true, idle: 0 }, "out", AT); // 1st not-in-game
  assert.deepEqual(s, { hot: true, idle: 1, presence: "out", presenceAt: AT }); // grace: still hot
  s = nextPresence(s, "out", AT); // 2nd not-in-game -> cool
  assert.deepEqual(s, { hot: false, idle: 2, presence: "out", presenceAt: AT });
});

test("nextPresence: unknown (private) leaves hot/idle untouched for the game-delta fallback", () => {
  assert.deepEqual(nextPresence({ hot: true, idle: 0 }, "unknown"), { hot: true, idle: 0, presence: "unknown" });
  assert.deepEqual(nextPresence({}, "unknown"), { presence: "unknown" });
});

// ---- the check is dated, because the answer is now published ---------------

test("nextPresence: a check that saw the profile records when", () => {
  const at = "2026-09-16T20:00:00.000Z";
  assert.equal(nextPresence({}, "in", at).presenceAt, at);
  assert.equal(nextPresence({}, "out", at).presenceAt, at);
});

test("nextPresence: a check that saw nothing does not re-date the last one", () => {
  // Otherwise a private profile's stale "in" would be stamped fresh on every
  // run and the board would insist somebody was playing indefinitely.
  const was = { presence: "in", presenceAt: "2026-09-16T19:00:00.000Z", hot: true, idle: 0 };
  assert.equal(nextPresence(was, "unknown", "2026-09-16T20:00:00.000Z").presenceAt, was.presenceAt);
});

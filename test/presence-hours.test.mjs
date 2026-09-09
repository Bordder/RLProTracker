// Presence hours: the only measurement of playing time the site has for a
// player who hides their Steam playtime, and the fallback the 2-week column
// leans on for 15 of the 94 rows.
//
// It was untested, and the two things it has to get right are both about
// missing data rather than arithmetic: a poll after an outage must not claim
// every minute since the last one as time played, and the windows must be
// measured from the last poll rather than from wall-clock now, so a stalled
// collector freezes the figures instead of decaying them towards zero while
// nothing is being measured.

import test from "node:test";
import assert from "node:assert/strict";
import { presenceHours } from "../scripts/computePresenceHours.mjs";

const T0 = Date.parse("2026-09-01T00:00:00.000Z");
const at = (min) => new Date(T0 + min * 60000).toISOString();
const hours = (res, id, win = "d1") => res.players.find((p) => p.id === id).presenceHours[win];

test("each poll credits the gap since the previous one", () => {
  // First poll has no predecessor, so it credits the intended interval: 5.
  // Then 3 gaps of 5 minutes each. 5 + 15 = 20 minutes.
  const res = presenceHours([
    { t: at(0), inGame: ["zen"] },
    { t: at(5), inGame: ["zen"] },
    { t: at(10), inGame: ["zen"] },
    { t: at(15), inGame: ["zen"] },
  ]);
  assert.equal(hours(res, "zen"), +(20 / 60).toFixed(1));
});

test("a long gap is capped, so an outage cannot invent playtime", () => {
  // Six hours passed with nobody polling. Without the cap this single poll
  // would credit 360 minutes of play that was never observed.
  const res = presenceHours([
    { t: at(0), inGame: ["zen"] },
    { t: at(360), inGame: ["zen"] },
  ]);
  assert.equal(hours(res, "zen"), +((5 + 10) / 60).toFixed(1), "5 for the first poll, capped 10 for the gap");
});

test("only the polls a player was in game for are credited to them", () => {
  const res = presenceHours([
    { t: at(0), inGame: ["zen", "rise"] },
    { t: at(5), inGame: ["zen"] },
    { t: at(10), inGame: [] },
    { t: at(15), inGame: ["rise"] },
  ]);
  assert.equal(hours(res, "zen"), +(10 / 60).toFixed(1));
  assert.equal(hours(res, "rise"), +(10 / 60).toFixed(1));
});

test("a player never seen in game does not appear at all", () => {
  // The row is blank rather than zero: we did not measure them, which is a
  // different statement from measuring them at nothing.
  const res = presenceHours([{ t: at(0), inGame: ["zen"] }]);
  assert.equal(res.players.length, 1);
  assert.equal(res.players.find((p) => p.id === "rise"), undefined);
});

test("windows are measured back from the last poll, not from wall-clock now", () => {
  // These polls are from 2026, long past. If the cutoff used Date.now() every
  // window would be empty and the site would show zeros for everyone the moment
  // collection stalled.
  const res = presenceHours([
    { t: at(0), inGame: ["zen"] },
    { t: at(5), inGame: ["zen"] },
  ]);
  assert.equal(res.now, T0 + 5 * 60000);
  assert.ok(hours(res, "zen") > 0);
});

test("a credit older than the window is excluded from it but kept in the wider one", () => {
  const dayAgo = 2 * 24 * 60; // 2 days before the final poll
  const res = presenceHours([
    { t: at(0), inGame: ["zen"] },
    { t: at(dayAgo), inGame: ["zen"] },
  ]);
  assert.equal(hours(res, "zen", "d1"), +(10 / 60).toFixed(1), "only the final poll falls inside 24h");
  assert.ok(hours(res, "zen", "d7") > hours(res, "zen", "d1"), "the older credit is still inside 7 days");
});

test("polls arriving out of order are sorted before crediting", () => {
  const ordered = presenceHours([
    { t: at(0), inGame: ["zen"] },
    { t: at(5), inGame: ["zen"] },
    { t: at(10), inGame: ["zen"] },
  ]);
  const shuffled = presenceHours([
    { t: at(10), inGame: ["zen"] },
    { t: at(0), inGame: ["zen"] },
    { t: at(5), inGame: ["zen"] },
  ]);
  assert.deepEqual(shuffled.players, ordered.players);
  assert.equal(shuffled.now, ordered.now);
});

test("a poll with no inGame field is tolerated rather than throwing", () => {
  // The log is append-only and written by a different script; a malformed line
  // should cost that poll, not the whole run.
  const res = presenceHours([
    { t: at(0), inGame: ["zen"] },
    { t: at(5) },
    { t: at(10), inGame: ["zen"] },
  ]);
  assert.equal(res.players.length, 1);
  assert.ok(hours(res, "zen") > 0);
});

// The phone's event view: header, schedule, teams and prize pool.
//
// This module used to import its neighbours by absolute path ("/crest.mjs"),
// which a browser resolves against the site root and node cannot resolve at
// all, so nothing in it could be tested. fixtures.mjs already imports
// "./crest.mjs" for exactly this reason, and resolves to the same URL on the
// site.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dateRange, finalOf } from "../web/eventview.mjs";

const plain = (s) => s.replace(/\s/g, " ");

test("the module loads under node", () => {
  assert.equal(typeof dateRange, "function");
});

test("an event's dates read as one range, in the order the locale uses", () => {
  const ev = { starts: "2026-09-15", ends: "2026-09-20" };
  assert.equal(plain(dateRange(ev, "en-GB")), "15 – 20 September 2026");
  assert.equal(plain(dateRange(ev, "en-US")), "September 15 – 20, 2026");
  assert.equal(plain(dateRange({ starts: "2026-09-30", ends: "2026-10-02" }, "en-GB")), "30 September – 2 October 2026");
  assert.equal(dateRange({ starts: "2026-09-18", ends: "2026-09-18" }, "en-GB"), "18 September 2026");
});

// The grand final, and only once it is over. The banner took the last match
// that had FINISHED, so at 00:30 UTC during the Worlds 2024 final it crowned
// the semifinal winner while the final was still being played.
const playoff = (gf) => ({ stages: [{ format: "3v3", brackets: [{ matches: [
  { round: 4, position: 1, label: "Semifinal", teams: ["Team BDS", "Team Falcons"], scores: [4, 2], finished: true },
  { round: 5, position: 1, label: "Grand Final", teams: ["G2 Stride", "Team BDS"], ...gf },
] }] }] });

test("no champion is named while the grand final is being played", () => {
  assert.equal(finalOf(playoff({ scores: [2, 2], finished: false, live: true })), null);
});

test("the champion comes from the grand final once it is finished", () => {
  const f = finalOf(playoff({ scores: [2, 4], finished: true }));
  assert.equal(f.label, "Grand Final");
});

// ---- who is still in it ------------------------------------------------------

import { teamsOf } from "../web/eventview.mjs";

const NOW = Date.parse("2026-09-18T12:00:00Z");
const running = (brackets, matchlists = [], tables = []) =>
  ({ starts: "2026-09-15", ends: "2026-09-20", stages: [{ brackets, matchlists, tables }] });
const outOf = (ev, now = NOW) => Object.fromEntries(teamsOf(ev, now).map((t) => [t.name, t.out]));

test("losing in the upper bracket is not being knocked out", () => {
  // B drops to the lower bracket, whose slot Liquipedia has not written yet.
  const ev = running([{ matches: [
    { round: 1, position: 1, section: "upper", teams: ["A", "B"], scores: [3, 1], finished: true },
    { round: 2, position: 1, section: "lower", teams: [null, "C"], scores: [null, null], finished: false },
  ] }]);
  assert.equal(outOf(ev).B, false);
});

test("losing a group match before the next round is drawn is not being knocked out", () => {
  const ev = running([], [{ matches: [{ teams: ["A", "B"], scores: [3, 0], finished: true }] }]);
  assert.equal(outOf(ev).B, false);
});

test("a lower-bracket loss, a final loss and a group table's 'down' are all out", () => {
  const ev = running([{ matches: [
    { round: 3, position: 1, section: "lower", teams: ["C", "D"], scores: [3, 2], finished: true },
    { round: 5, position: 1, section: "final", teams: ["A", "C"], scores: [4, 1], finished: true },
  ] }], [{ matches: [{ teams: ["E", "F"], scores: [3, 1], finished: true }] }],
  [{ rows: [{ team: "F", outcome: "down" }] }]);
  const out = outOf(ev);
  assert.deepEqual([out.A, out.C, out.D, out.F], [false, true, true, true]);
});

test("once the event is over, everyone who lost is out", () => {
  const ev = running([], [{ matches: [{ teams: ["A", "B"], scores: [3, 0], finished: true }] }]);
  assert.equal(outOf(ev, Date.parse("2026-10-01T12:00:00Z")).B, true);
});

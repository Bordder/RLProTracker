// The phone's event view: header, schedule, teams and prize pool.
//
// This module used to import its neighbours by absolute path ("/crest.mjs"),
// which a browser resolves against the site root and node cannot resolve at
// all, so nothing in it could be tested. fixtures.mjs already imports
// "./crest.mjs" for exactly this reason, and resolves to the same URL on the
// site.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dateRange, finalOf, placingsOf, prizesHTML } from "../web/eventview.mjs";

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

// Low 14: the prize table names who finished where, from the last bracket,
// once its grand final is over. Worlds 2025's playoff, as parsed.
const worlds25 = (gf) => [{ format: null, prizes: [
  { place: "1", usd: 700000 }, { place: "2", usd: 300000 }, { place: "3-4", usd: 150000 },
  { place: "5-6", usd: 80000 }, { place: "7-8", usd: 55000 }, { place: "9-12", usd: 30000 },
], brackets: [{ matches: [
  { round: 1, position: 1, section: "lower", finished: true, teams: ["Karmine Corp", "Ninjas in Pyjamas"], scores: [4, 2] },
  { round: 1, position: 2, section: "lower", finished: true, teams: ["Spacestation Gaming", "Geekay Esports"], scores: [1, 4] },
  { round: 2, position: 1, section: "upper", finished: true, teams: ["The Ultimates", "NRG"], scores: [3, 4] },
  { round: 2, position: 2, section: "upper", finished: true, teams: ["Team Falcons", "Wildcard"], scores: [4, 1] },
  { round: 2, position: 3, section: "lower", finished: true, teams: ["The Ultimates", "Karmine Corp"], scores: [0, 4] },
  { round: 2, position: 4, section: "lower", finished: true, teams: ["Wildcard", "Geekay Esports"], scores: [1, 4] },
  { round: 3, position: 1, section: "final", finished: true, teams: ["Team Falcons", "Karmine Corp"], scores: [4, 2] },
  { round: 3, position: 2, section: "final", finished: true, teams: ["NRG", "Geekay Esports"], scores: [4, 0] },
  { round: 4, position: 1, section: "final", teams: ["Team Falcons", "NRG"], ...gf },
] }] }];

test("a finished event's prize table names who finished where", () => {
  const st = worlds25({ finished: true, scores: [1, 4] });
  const p = placingsOf(st, st[0].prizes);
  assert.deepEqual(p.get("1"), ["NRG"]);
  assert.deepEqual(p.get("2"), ["Team Falcons"]);
  assert.deepEqual(p.get("3-4"), ["Geekay Esports", "Karmine Corp"]);
  assert.deepEqual(p.get("5-6"), ["The Ultimates", "Wildcard"]);
  assert.deepEqual(p.get("7-8"), ["Ninjas in Pyjamas", "Spacestation Gaming"]);
  // 9-12 was decided in the groups, which this bracket does not show.
  assert.equal(p.has("9-12"), false);
  // Champion agrees with the banner.
  const f = finalOf({ stages: st });
  assert.equal(f.teams[f.scores[0] > f.scores[1] ? 0 : 1], p.get("1")[0]);
  const html = prizesHTML({ stages: st });
  assert.ok(html.includes("NRG"));
  assert.equal((html.match(/>TBD</g) ?? []).length, 1, "only 9-12 stays TBD");
  // One row per team: 1, 2, two each for 3-4 / 5-6 / 7-8, and 9-12.
  assert.equal((html.match(/<tr><td class="eplace/g) ?? []).length, 9);
});

test("nothing is filled while the grand final is still to be played", () => {
  for (const gf of [{ finished: false, scores: [2, 2] }, { finished: false, scores: [null, null] }]) {
    const st = worlds25(gf);
    assert.equal(placingsOf(st, st[0].prizes).size, 0);
    assert.equal((prizesHTML({ stages: st }).match(/>TBD</g) ?? []).length, 6);
  }
});

test("a place the bracket's rounds do not fit exactly stops the fill there", () => {
  // Four teams out in the lower bracket's first round, but the table pays
  // 5-6 as a pair: which two of the four is not in the bracket, so 5-6 and
  // everything after it stays TBD rather than being guessed.
  const stages = [{ prizes: [{ place: "1", usd: 1 }, { place: "2", usd: 1 }, { place: "3-4", usd: 1 }, { place: "5-6", usd: 1 }, { place: "7-8", usd: 1 }],
    brackets: [{ matches: [
      { round: 1, position: 1, section: "lower", finished: true, teams: ["A", "B"], scores: [4, 0] },
      { round: 1, position: 2, section: "lower", finished: true, teams: ["C", "D"], scores: [4, 0] },
      { round: 1, position: 3, section: "lower", finished: true, teams: ["E", "F"], scores: [4, 0] },
      { round: 1, position: 4, section: "lower", finished: true, teams: ["G", "H"], scores: [4, 0] },
      { round: 2, position: 1, section: "final", finished: true, teams: ["A", "C"], scores: [4, 0] },
      { round: 2, position: 2, section: "final", finished: true, teams: ["E", "G"], scores: [4, 0] },
      { round: 3, position: 1, section: "final", finished: true, teams: ["A", "E"], scores: [4, 1] },
    ] }] }];
  const p = placingsOf(stages, stages[0].prizes);
  assert.deepEqual([...p.keys()], ["1", "2", "3-4"]);
  assert.deepEqual(p.get("3-4"), ["C", "G"]);
});

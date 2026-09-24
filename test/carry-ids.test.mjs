// Low 33: a transfer gives a player a new roster id, and their stores follow
// them when, and only when, the new id is read from the same account.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  accountOf, steamOf, planCarry, trackerAccounts, steamAccounts,
  moveReadings, moveState, movePeaks, carryTracker,
} from "../scripts/carryIds.mjs";
import { appendRows } from "../scripts/trackerHistory.mjs";
import { peakFor } from "../scripts/peakMmr.mjs";

const pl = (rating) => ({ d2: { rating, matchesPlayed: 100 } });

// Zen moved from Vitality to a new team: same Steam account, new id.
const roster = [
  { id: "new-team-zen", name: "zen", team: "New Team", steamId64: "111", epic: null },
  { id: "karmine-corp-vatira", name: "Vatira", team: "Karmine Corp", steamId64: "222", epic: null },
];
const stores = () => ({
  history: { players: {
    "team-vitality-zen": { name: "zen", team: "Team Vitality", readings: [
      { t: 1000, who: "steam:111", playlists: pl(1900) },
      { t: 2000, who: "steam:111", playlists: pl(1950) },
    ] },
    "karmine-corp-vatira": { name: "Vatira", team: "Karmine Corp", readings: [{ t: 2000, who: "steam:222", playlists: pl(2000) }] },
  } },
  state: { "team-vitality-zen": { last: 2000, fails: 0, matches: 100, idle: 3 } },
  peaks: { players: { "team-vitality-zen": { accounts: { "steam:111": { twos: { rating: 2100, at: "x" } } } } } },
});

test("a transfer is carried: history, state and peaks move to the new id", () => {
  const s = stores();
  const plan = planCarry(roster, trackerAccounts(s.history, s.peaks));
  assert.deepEqual(plan, [{ from: "team-vitality-zen", to: "new-team-zen", account: "steam:111" }]);
  const out = carryTracker(s, plan, roster);
  assert.equal(out.history.players["team-vitality-zen"], undefined);
  assert.deepEqual(out.history.players["new-team-zen"].readings.map((r) => r.t), [1000, 2000]);
  assert.equal(out.history.players["new-team-zen"].team, "New Team");
  assert.equal(out.state["team-vitality-zen"], undefined);
  assert.equal(out.state["new-team-zen"].matches, 100);
  assert.equal(out.peaks.players["team-vitality-zen"], undefined);
  assert.equal(peakFor(out.peaks, "new-team-zen", "steam:111").twos, 2100);
  // Untouched: the player who did not move.
  assert.deepEqual(out.history.players["karmine-corp-vatira"], s.history.players["karmine-corp-vatira"]);
});

test("the carried history survives the collector's next append", () => {
  // appendRows drops every id off the roster, which is what lost the history
  // before; carried first, the new id holds it.
  const s = stores();
  const out = carryTracker(s, planCarry(roster, trackerAccounts(s.history, s.peaks)), roster);
  const next = appendRows(out.history, 3000, [{ id: "new-team-zen", name: "zen", team: "New Team", steamId64: "111", playlists: pl(1960) }],
    3000, new Set(roster.map((p) => p.id)));
  assert.deepEqual(next.players["new-team-zen"].readings.map((r) => r.t), [1000, 2000, 3000]);
});

test("an account change on the same id is not a transfer and moves nothing", () => {
  // Vatira's id stays; her account moves from Steam to Epic. There is no old
  // id to carry from, so every store comes back as it was.
  const s = stores();
  const changed = roster.map((p) => (p.id === "karmine-corp-vatira" ? { ...p, epic: "Vatira", steamId64: null } : p));
  const plan = planCarry(changed, trackerAccounts(s.history, s.peaks)).filter((m) => m.to === "karmine-corp-vatira");
  assert.deepEqual(plan, []);
});

test("a new id on a different account is a different player and is not merged", () => {
  // Zen's old id is off the roster, and his team's new player holds a new id,
  // but on another account: a replacement, not a transfer.
  const s = stores();
  const other = [{ id: "team-vitality-newkid", name: "newkid", team: "Team Vitality", steamId64: "999" }, roster[1]];
  const plan = planCarry(other, trackerAccounts(s.history, s.peaks));
  assert.deepEqual(plan, []);
  const out = carryTracker(s, plan, other);
  assert.deepEqual(out, s);
});

test("a transfer that also changes account is not merged", () => {
  // Nothing ties the two ids together but a name, and names are not unique.
  const s = stores();
  const moved = [{ id: "new-team-zen", name: "zen", team: "New Team", epic: "zen-epic" }, roster[1]];
  assert.deepEqual(planCarry(moved, trackerAccounts(s.history, s.peaks)), []);
});

test("an ambiguous account is left alone rather than guessed", () => {
  const s = stores();
  // Two roster ids on one account.
  const twice = [...roster, { id: "other-team-zen", name: "zen", team: "Other", steamId64: "111" }];
  assert.deepEqual(planCarry(twice, trackerAccounts(s.history, s.peaks)), []);
  // Two old ids on one account.
  s.history.players["old-team-zen"] = { name: "zen", readings: [{ t: 500, who: "steam:111", playlists: pl(1800) }] };
  assert.deepEqual(planCarry(roster, trackerAccounts(s.history, s.peaks)), []);
});

test("an old id with no account on record is not merged", () => {
  const s = stores();
  s.history.players["team-vitality-zen"].readings = s.history.players["team-vitality-zen"].readings.map(({ who, ...r }) => r);
  delete s.peaks.players["team-vitality-zen"];
  assert.deepEqual(planCarry(roster, trackerAccounts(s.history, s.peaks)), []);
});

test("peaks alone name the account when the history is gone", () => {
  const s = stores();
  delete s.history.players["team-vitality-zen"];
  const plan = planCarry(roster, trackerAccounts(s.history, s.peaks));
  assert.deepEqual(plan.map((m) => m.to), ["new-team-zen"]);
});

test("readings merge in time order when the new id already has some", () => {
  const doc = { players: {
    a: { name: "zen", readings: [{ t: 1, v: "old" }, { t: 3, v: "old" }] },
    b: { name: "zen", readings: [{ t: 2, v: "new" }, { t: 3, v: "new" }] },
  } };
  const out = moveReadings(doc, { from: "a", to: "b" }, { name: "zen", team: "T" });
  assert.deepEqual(out.players.b.readings, [{ t: 1, v: "old" }, { t: 2, v: "new" }, { t: 3, v: "new" }]);
  assert.equal(out.players.a, undefined);
});

test("state keeps the new id's own fields and fills the rest from the old", () => {
  const out = moveState({ a: { last: 5, matches: 100, idle: 2 }, b: { presence: "in", hot: true } }, { from: "a", to: "b" });
  assert.deepEqual(out, { b: { last: 5, matches: 100, idle: 2, presence: "in", hot: true } });
});

test("peaks keep the higher of each entry, per account", () => {
  const out = movePeaks({ players: {
    a: { twos: { rating: 1500 }, accounts: { "steam:1": { twos: { rating: 2000 }, twosBest: { rating: 2100, season: 20 } } } },
    b: { twos: { rating: 1600 }, accounts: { "steam:1": { twos: { rating: 1900 } } } },
  } }, { from: "a", to: "b" });
  assert.deepEqual(out.players, { b: {
    twos: { rating: 1600 },
    accounts: { "steam:1": { twos: { rating: 2000 }, twosBest: { rating: 2100, season: 20 } } },
  } });
});

test("the Steam side matches on the Steam id, whatever Epic name the roster has", () => {
  const history = { players: { "team-vitality-zen": { name: "zen", readings: [{ t: 1, steamId64: "111", status: "ok" }] } } };
  const withEpic = [{ ...roster[0], epic: "zen-epic" }];
  assert.equal(accountOf(withEpic[0]), "epic:zen-epic");
  assert.equal(steamOf(withEpic[0]), "steam:111");
  const plan = planCarry(withEpic, steamAccounts(history), steamOf);
  assert.deepEqual(plan.map((m) => [m.from, m.to]), [["team-vitality-zen", "new-team-zen"]]);
});

test("the carry runs first in both collectors, before anything can drop the old id", () => {
  const { scripts } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(scripts.tracker, /^node scripts\/carryIds\.mjs tracker && /);
  assert.match(scripts.update, /^node scripts\/carryIds\.mjs steam && /);
});

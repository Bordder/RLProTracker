// The two team rollups. Both were untested until now, and both decide what a
// whole tab of the site prints.
//
// The cases that matter are the ones where a value is MISSING rather than zero.
// A team whose players keep their hours private must not read as a team that
// never plays, and a window still filling must not be counted at all - a player
// added today reports his entire season as the diff, which would land in the
// team total as a thousand games in a day.

import test from "node:test";
import assert from "node:assert/strict";
import { teamHours } from "../scripts/aggregate.mjs";
import { teamTracker } from "../scripts/aggregateTracker.mjs";

const player = (over = {}) => ({
  team: "A",
  totalHours: 100,
  steam2wkHours: 10,
  windows: { d1: { hours: 1 }, d7: { hours: 5 }, d14: { hours: 9 } },
  ...over,
});

test("teamHours sums only the players who publish hours, and counts both", () => {
  const teams = teamHours([
    player(),
    player(),
    player({ totalHours: null, steam2wkHours: null, windows: null }),
  ]);
  assert.equal(teams.length, 1);
  const t = teams[0];
  assert.equal(t.players, 3);
  assert.equal(t.tracked, 2, "the private player is counted in players, not tracked");
  assert.equal(t.totalHours, 200);
  assert.equal(t.steam2wkHours, 20);
  assert.deepEqual(t.windows, { d1: 2, d7: 10, d14: 18 });
});

test("teamHours reports zero hours for a team where nobody publishes", () => {
  // Zero here is not "they never play", and the frontend needs tracked=0 to say
  // so. The numbers must still be numbers rather than NaN.
  const [t] = teamHours([player({ totalHours: null, steam2wkHours: null, windows: null })]);
  assert.equal(t.tracked, 0);
  assert.equal(t.totalHours, 0);
  assert.equal(t.steam2wkHours, 0);
  assert.deepEqual(t.windows, { d1: 0, d7: 0, d14: 0 });
});

test("teamHours treats a player with no team as Unknown rather than dropping them", () => {
  const teams = teamHours([player({ team: null }), player({ team: undefined })]);
  assert.deepEqual(teams.map((t) => t.team), ["Unknown"]);
  assert.equal(teams[0].players, 2);
});

test("teamHours orders teams by 14-day hours, most active first", () => {
  const teams = teamHours([
    player({ team: "quiet", windows: { d1: {}, d7: {}, d14: { hours: 2 } } }),
    player({ team: "busy", windows: { d1: {}, d7: {}, d14: { hours: 40 } } }),
  ]);
  assert.deepEqual(teams.map((t) => t.team), ["busy", "quiet"]);
});

const tracked = (over = {}) => ({
  team: "A",
  mmr: { ones: 1000, twos: 2000, threes: 1500 },
  seasonGames: { total: 500 },
  games: { total: { d1: { games: 5, partial: false }, d7: { games: 50, partial: false }, d14: { games: 90, partial: false } } },
  ...over,
});

test("teamTracker averages MMR over the players who have one", () => {
  const [t] = teamTracker([
    tracked(),
    tracked({ mmr: { ones: 2000, twos: 3000, threes: 2500 } }),
    tracked({ mmr: null }), // unranked or never read
  ]);
  assert.equal(t.players, 3);
  assert.equal(t.ranked, 2, "ranked counts players with a 2v2 rating");
  assert.deepEqual(t.avgMmr, { ones: 1500, twos: 2500, threes: 2000 });
});

test("teamTracker excludes a partial window from the team total", () => {
  // The whole reason this filter exists: a player added today reports his season
  // as the diff, and 900 games would land in the team's 24 hours.
  const [t] = teamTracker([
    tracked(),
    tracked({ games: { total: { d1: { games: 900, partial: true }, d7: { games: 900, partial: true }, d14: { games: 900, partial: true } } } }),
  ]);
  assert.deepEqual(t.games, { d1: 5, d7: 50, d14: 90 });
});

test("teamTracker reports null, not zero, when every window is still filling", () => {
  // Zero would print as "this team played nothing", which is a different claim
  // from "we cannot say yet".
  const [t] = teamTracker([
    tracked({ games: { total: { d1: { games: 9, partial: true }, d7: { games: 9, partial: true }, d14: { games: 9, partial: true } } } }),
  ]);
  assert.deepEqual(t.games, { d1: null, d7: null, d14: null });
});

test("teamTracker gives null MMR and null season games when nothing is known", () => {
  const [t] = teamTracker([tracked({ mmr: null, seasonGames: null })]);
  assert.deepEqual(t.avgMmr, { ones: null, twos: null, threes: null });
  assert.equal(t.seasonGames, null);
  assert.equal(t.ranked, 0);
});

test("teamTracker orders teams by average 2v2, and a team with no rating sorts last", () => {
  const teams = teamTracker([
    tracked({ team: "mid", mmr: { twos: 2000 } }),
    tracked({ team: "top", mmr: { twos: 3000 } }),
    tracked({ team: "none", mmr: null }),
  ]);
  assert.deepEqual(teams.map((t) => t.team), ["top", "mid", "none"]);
});

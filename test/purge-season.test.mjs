// What the once-a-season purge does to three months of collected data.
//
// It runs under supervision on the day a season ends and cannot be rehearsed
// on the real thing, so the two transforms it is made of are tested here
// instead. Everything else in the script is reading files and printing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { purgeHistory, resetState } from "../scripts/purgeSeason.mjs";

const AT = "2026-09-23T12:00:00.000Z";

const history = () => ({
  updatedAt: "2026-09-23T11:58:00.000Z",
  players: {
    "karmine-corp-atow": {
      name: "Atow.",
      team: "Karmine Corp",
      readings: [
        { t: 1788043268699, playlists: { d2: { rating: 2611, matches: 1111, tier: "Supersonic Legend" } } },
        { t: 1788133265701, playlists: { d2: { rating: 2624, matches: 1140, tier: "Supersonic Legend" } } },
      ],
    },
    "nrg-daniel": { name: "Daniel", team: "NRG", readings: [{ t: 1788133265701, playlists: {} }] },
  },
});

test("the readings go and the players stay", () => {
  const out = purgeHistory(history(), AT);

  assert.deepEqual(Object.keys(out.players), ["karmine-corp-atow", "nrg-daniel"]);
  for (const p of Object.values(out.players)) assert.deepEqual(p.readings, []);
  // The collector's own index of who it tracks. Dropping it makes the first
  // run of a season read as a roster wipe in the logs.
  assert.equal(out.players["karmine-corp-atow"].name, "Atow.");
  assert.equal(out.players["karmine-corp-atow"].team, "Karmine Corp");
});

test("the boundary is recorded, not just the time of the run", () => {
  const out = purgeHistory(history(), AT);
  assert.equal(out.seasonStartedAt, AT);
  assert.equal(out.updatedAt, AT);
});

test("purging an already empty history is harmless", () => {
  const out = purgeHistory({ players: {} }, AT);
  assert.deepEqual(out.players, {});
  assert.equal(out.seasonStartedAt, AT);
});

test("the cumulative baseline is forgotten and nothing else is", () => {
  const before = {
    "karmine-corp-atow": { last: "2026-09-23T11:58:00.000Z", fails: 0, presence: "in", matches: 1583, hot: true, idle: 0 },
    "nrg-daniel": { last: "2026-09-23T11:40:00.000Z", fails: 2, presence: "out", matches: 904, hot: false, idle: 74 },
  };
  const after = resetState(before);

  for (const s of Object.values(after)) assert.equal(s.matches, null);
  // Presence, failure counts and idle backoff are not season-bound: losing
  // them would put every player back on the full scrape cadence at once.
  assert.equal(after["nrg-daniel"].fails, 2);
  assert.equal(after["nrg-daniel"].idle, 74);
  assert.equal(after["karmine-corp-atow"].hot, true);
  assert.equal(after["karmine-corp-atow"].last, "2026-09-23T11:58:00.000Z");
});

test("a player with no baseline yet is left as it is", () => {
  const after = resetState({ new_player: { last: null, fails: 0, matches: null } });
  assert.equal(after.new_player.matches, null);
});

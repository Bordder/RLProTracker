// Unit tests for the rolling Steam history. Retention itself is covered by the
// tracker-history suite (both share rollingHistory.mjs); these cover the
// Steam-specific folding and the shape handed back to computeSteamPlayers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendSteamRows, historyToSteamSnaps } from "../scripts/steamHistory.mjs";
import { countReadings, HOUR } from "../scripts/rollingHistory.mjs";

const T = 1_800_000_000_000;
const row = (id, foreverMin, status = "public", extra = {}) =>
  ({ id, name: id, team: "T", status, foreverMin, twoWeeksMin: 60, visibility: 3, steamId64: "765" + id, ...extra });

test("folds a run in and preserves the fields the delta core reads", () => {
  const h = appendSteamRows({}, T, [row("a", 6000)]);
  const snaps = historyToSteamSnaps(h);
  assert.equal(snaps.length, 1);
  const r = snaps[0].rows[0];
  assert.equal(r.id, "a");
  assert.equal(r.foreverMin, 6000);
  assert.equal(r.twoWeeksMin, 60);
  assert.equal(r.status, "public");
  assert.equal(r.name, "a");
});

test("keeps a private reading rather than skipping it", () => {
  // "we looked and Steam gave nothing" is meaningful - it marks the gap the
  // last-known store fills, so it must not be dropped like a failed scrape.
  const h = appendSteamRows({}, T, [row("a", null, "private")]);
  const r = historyToSteamSnaps(h)[0].rows[0];
  assert.equal(r.foreverMin, null);
  assert.equal(r.status, "private");
});

test("re-running the same timestamp replaces rather than duplicates", () => {
  let h = appendSteamRows({}, T, [row("a", 6000)]);
  h = appendSteamRows(h, T, [row("a", 6100)]);
  assert.equal(countReadings(h), 1);
  assert.equal(historyToSteamSnaps(h)[0].rows[0].foreverMin, 6100);
});

test("players missing from a run keep their readings", () => {
  let h = appendSteamRows({}, T - HOUR, [row("a", 6000), row("b", 300)]);
  h = appendSteamRows(h, T, [row("a", 6060)]);
  assert.equal(countReadings(h), 3);
  assert.ok(h.players.b, "b survives a run it was absent from");
});

test("groups readings by timestamp across players", () => {
  let h = appendSteamRows({}, T - HOUR, [row("a", 6000), row("b", 300)]);
  h = appendSteamRows(h, T, [row("a", 6060)]);
  const snaps = historyToSteamSnaps(h);
  assert.deepEqual(snaps.map((s) => s.t), [T - HOUR, T]);
  assert.equal(snaps[0].rows.length, 2);
  assert.equal(snaps[1].rows.length, 1);
});

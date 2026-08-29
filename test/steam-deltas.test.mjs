// Unit tests for the Steam hours core (computeSteamPlayers). Pure, no IO.
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSteamPlayers } from "../scripts/computeDeltas.mjs";

const HOUR = 3600e3;
const T0 = 1_000_000_000_000;
const T25 = T0 + 25 * HOUR; // d1 window start (now-24h) = T0+1h

// foreverMin/twoWeeksMin are minutes; hours = /60
const r = (id, foreverMin, twoWeeksMin = null, status = "public") =>
  ({ id, name: id, team: "Team", status, foreverMin, twoWeeksMin });

function run(snaps) {
  const { now, players } = computeSteamPlayers(snaps);
  return { now, byId: new Map(players.map((p) => [p.id, p])) };
}

test("now is the latest snapshot time; unsorted input is handled", () => {
  const { now } = run([
    { t: T25, rows: [r("a", 6000)] },
    { t: T0, rows: [r("a", 5940)] }, // out of order on purpose
  ]);
  assert.equal(now, T25);
});

test("window hours diff and total/2wk hours", () => {
  const { byId } = run([
    { t: T0, rows: [r("a", 6000, 300)] },   // 100h total
    { t: T25, rows: [r("a", 6120, 240)] },  // +120 min = +2.0h over the span
  ]);
  const p = byId.get("a");
  assert.equal(p.totalHours, 102); // 6120/60
  assert.equal(p.steam2wkHours, 4); // 240/60, from latest snapshot
  // only prior reading is T0, so d1 diff spans it and is not partial (history at/before now-24h)
  assert.deepEqual(p.windows.d1, { hours: 2, partial: false });
});

test("player absent from the past snapshot yields null window hours (partial)", () => {
  const { byId } = run([
    { t: T0, rows: [r("a", 6000)] },            // "b" not present yet
    { t: T25, rows: [r("a", 6060), r("b", 900)] },
  ]);
  const b = byId.get("b");
  assert.equal(b.totalHours, 15);
  // no history for b at now-24h -> snapAtOrBefore falls back to earliest, which lacks b -> null
  assert.equal(b.windows.d1.hours, null);
  assert.equal(b.windows.d1.partial, true);
});

test("null playtime (private/Epic) yields null hours, not zero", () => {
  const { byId } = run([
    { t: T0, rows: [r("a", null, null, "private")] },
    { t: T25, rows: [r("a", null, null, "private")] },
  ]);
  const p = byId.get("a");
  assert.equal(p.totalHours, null);
  assert.equal(p.steam2wkHours, null);
  assert.equal(p.windows.d1.hours, null);
  assert.equal(p.windows.d7.partial, true);
});

test("shallow history flags d7/d14 partial while d1 has data", () => {
  const { byId } = run([
    { t: T0, rows: [r("a", 6000)] },
    { t: T25, rows: [r("a", 6090)] },
  ]);
  const p = byId.get("a");
  assert.equal(p.windows.d1.partial, false);
  assert.equal(p.windows.d7.partial, true);
  assert.equal(p.windows.d14.partial, true);
});

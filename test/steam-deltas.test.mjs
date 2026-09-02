// Unit tests for the Steam hours core (computeSteamPlayers). Pure, no IO.
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSteamPlayers, mergeLastKnown } from "../scripts/computeDeltas.mjs";

const HOUR = 3600e3;
const T0 = 1_000_000_000_000;
const T25 = T0 + 25 * HOUR; // d1 window start (now-24h) = T0+1h

// foreverMin/twoWeeksMin are minutes; hours = /60
const r = (id, foreverMin, twoWeeksMin = null, status = "public") =>
  ({ id, name: id, team: "Team", status, foreverMin, twoWeeksMin });

function run(snaps, lastKnown) {
  const { now, players } = computeSteamPlayers(snaps, lastKnown);
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

// ---- durable last-known totals (profile opens, then closes again) ----

test("mergeLastKnown records a reading and keeps the highest seen", () => {
  const s1 = mergeLastKnown({}, T0, [r("a", 6000), r("b", null, null, "private")]);
  assert.equal(s1.a.foreverMin, 6000);
  assert.equal(s1.a.at, new Date(T0).toISOString());
  assert.equal(s1.b, undefined); // nothing to record for a private profile

  const s2 = mergeLastKnown(s1, T25, [r("a", 6090)]);
  assert.equal(s2.a.foreverMin, 6090);
  assert.equal(s2.a.at, new Date(T25).toISOString());

  // a lower/equal reading must not overwrite, nor move the recorded date
  const s3 = mergeLastKnown(s2, T25 + HOUR, [r("a", 6090)]);
  assert.equal(s3.a.at, new Date(T25).toISOString());
  const s4 = mergeLastKnown(s2, T25 + HOUR, [r("a", 10)]);
  assert.equal(s4.a.foreverMin, 6090);
});

test("mergeLastKnown does not mutate the store it is given", () => {
  const store = {};
  mergeLastKnown(store, T0, [r("a", 6000)]);
  assert.deepEqual(store, {});
});

test("a re-privatised player falls back to the stored total, marked frozen", () => {
  const { byId } = run(
    [
      { t: T0, rows: [r("a", 6000)] },                       // public: 100h
      { t: T25, rows: [r("a", null, null, "private")] },      // closed again
    ],
    { a: { foreverMin: 6000, at: new Date(T0).toISOString() } }
  );
  const p = byId.get("a");
  assert.equal(p.totalHours, 100);
  assert.equal(p.totalHoursFrozenAt, new Date(T0).toISOString());
  assert.equal(p.steam2wkHours, null); // rolling window is never carried over
});

test("a live reading wins over the stored one and is not marked frozen", () => {
  const { byId } = run(
    [{ t: T0, rows: [r("a", 6000)] }, { t: T25, rows: [r("a", 6600)] }],
    { a: { foreverMin: 6000, at: new Date(T0).toISOString() } }
  );
  const p = byId.get("a");
  assert.equal(p.totalHours, 110);
  assert.equal(p.totalHoursFrozenAt, null);
});

test("a player with no stored reading still shows blank when private", () => {
  const { byId } = run([{ t: T25, rows: [r("a", null, null, "private")] }], {});
  assert.equal(byId.get("a").totalHours, null);
  assert.equal(byId.get("a").totalHoursFrozenAt, null);
});

// A profile that keeps its total playtime private reports 0 rather than
// withholding the game, so the zero has to be treated as "no reading" all the
// way through: never published, never stored, and never allowed to overwrite a
// real capture from when the profile was open.
test("a hidden total is not published as zero hours", () => {
  const snaps = [{ t: 2000, rows: [{ id: "p", name: "P", team: "T", status: "playtime-hidden", foreverMin: 0, twoWeeksMin: 0 }] }];
  const { players } = computeSteamPlayers(snaps, {});
  assert.equal(players[0].totalHours, null);
  assert.equal(players[0].steam2wkHours, null);
});

test("a total captured while open survives the profile hiding it", () => {
  const snaps = [{ t: 5000, rows: [{ id: "p", name: "P", team: "T", status: "playtime-hidden", foreverMin: 0, twoWeeksMin: 0 }] }];
  const lastKnown = { p: { foreverMin: 6000, at: "2026-08-30T10:00:00.000Z" } };
  const { players } = computeSteamPlayers(snaps, lastKnown);
  assert.equal(players[0].totalHours, 100);
  assert.equal(players[0].totalHoursFrozenAt, "2026-08-30T10:00:00.000Z");
  // The fortnight figure is deliberately NOT carried over: it is a rolling
  // window, so a stale value would read as recent activity.
  assert.equal(players[0].steam2wkHours, null);
});

test("a hidden zero never becomes a stored capture", () => {
  const store = mergeLastKnown({}, 1000, [{ id: "p", foreverMin: 0 }]);
  assert.deepEqual(store, {});
});

test("a hidden zero cannot overwrite a real capture", () => {
  const store = mergeLastKnown({ p: { foreverMin: 6000, at: "2026-08-30T10:00:00.000Z" } }, 9000, [{ id: "p", foreverMin: 0 }]);
  assert.equal(store.p.foreverMin, 6000);
  assert.equal(store.p.at, "2026-08-30T10:00:00.000Z");
});

// The peak MMR store. Pure, no IO.
//
// The property that matters is that a peak never goes down and never depends
// on the readings still existing: everything else on the board is rebuilt from
// tracker-history.json, and that file is thinned at 90 days and emptied at a
// season boundary. The peak is all time and is never reset.
import { test } from "node:test";
import assert from "node:assert/strict";
import { updatePeaks, peakFor, MAX_JUMP } from "../scripts/peakMmr.mjs";
import { purgeHistory } from "../scripts/purgeSeason.mjs";

const T0 = Date.parse("2026-07-01T00:00:00Z");
const at = (h) => T0 + h * 3600e3;
const snap = (h, rating, id = "p1") => ({
  t: at(h),
  rows: [{ id, playlists: { d2: { rating, matches: 100, tier: "Supersonic Legend" } } }],
});

test("the highest rating seen becomes the peak", () => {
  const store = updatePeaks({ players: {} }, [snap(0, 2600), snap(1, 2680), snap(2, 2640)]);
  assert.equal(store.players.p1.twos.rating, 2680);
  assert.equal(store.players.p1.twos.at, new Date(at(1)).toISOString());
});

test("a peak is never lowered by a later run", () => {
  // The whole reason this is a store and not a derivation.
  const first = updatePeaks({ players: {} }, [snap(0, 2680)]);
  const second = updatePeaks(first, [snap(5, 2500)]);
  assert.equal(second.players.p1.twos.rating, 2680);
});

test("a peak outlives the readings that produced it", () => {
  // After purgeSeason the history is empty. A run against no readings at all
  // must leave every peak standing, because that is the day it matters.
  const held = updatePeaks({ players: {} }, [snap(0, 2680)]);
  assert.equal(updatePeaks(held, []).players.p1.twos.rating, 2680);
});

test("snapshots out of order still date the peak correctly", () => {
  const store = updatePeaks({ players: {} }, [snap(2, 2600), snap(0, 2500), snap(1, 2700)]);
  assert.equal(store.players.p1.twos.rating, 2700);
  assert.equal(store.players.p1.twos.at, new Date(at(1)).toISOString());
});

test("an implausible leap is refused, and does not become the baseline", () => {
  // A rating moves ten to twenty points a match. A jump of MAX_JUMP+ between
  // consecutive readings is the counter moving underneath us - a relinked
  // account, a wiki edit pointing at the wrong profile. Every other figure on
  // the board recovers from that on the next run; a maximum would carry it
  // until the season ended.
  const store = updatePeaks({ players: {} }, [
    snap(0, 2600),
    snap(1, 2600 + MAX_JUMP + 1),  // refused
    snap(2, 2650),                  // a plausible step from 2600, not from the leap
  ]);
  assert.equal(store.players.p1.twos.rating, 2650);
});

test("a first reading has nothing to be a jump from", () => {
  // A player joining the roster mid-season arrives at whatever they are rated,
  // and refusing that would leave them with no peak at all.
  const store = updatePeaks({ players: {} }, [snap(0, 2800)]);
  assert.equal(store.players.p1.twos.rating, 2800);
});

test("playlists are kept apart", () => {
  const rows = [{ id: "p1", playlists: { d1: { rating: 1500 }, d2: { rating: 2600 }, d3: { rating: 1400 } } }];
  const store = updatePeaks({ players: {} }, [{ t: at(0), rows }]);
  assert.deepEqual(
    { ones: store.players.p1.ones.rating, twos: store.players.p1.twos.rating, threes: store.players.p1.threes.rating },
    { ones: 1500, twos: 2600, threes: 1400 }
  );
});

test("peakFor publishes the ratings and the most recent date", () => {
  const rows = [{ id: "p1", playlists: { d1: { rating: 1500 }, d2: { rating: 2600 } } }];
  const store = updatePeaks({ players: {} }, [{ t: at(0), rows }, snap(9, 2700)]);
  const out = peakFor(store, "p1");
  assert.equal(out.twos, 2700);
  assert.equal(out.ones, 1500);
  assert.equal(out.at, new Date(at(9)).toISOString());
  assert.equal(peakFor(store, "nobody"), null);
});

test("a reading with no rating is not a peak of zero", () => {
  const store = updatePeaks({ players: {} }, [{ t: at(0), rows: [{ id: "p1", playlists: { d2: {} } }] }]);
  assert.equal(peakFor(store, "p1"), null);
});

// ---- the boundary ---------------------------------------------------------

test("a season boundary does not touch the peaks", () => {
  // purgeSeason empties the readings a peak was computed from. The store is
  // separate for that reason, and the peak is all time: it stands until
  // somebody beats it, whatever season they beat it in.
  const store = updatePeaks({ players: {} }, [snap(0, 2680)]);
  const history = { players: { p1: { readings: [{ t: at(0) }] } } };
  const purged = purgeHistory(history, "2026-09-23T18:00:00.000Z");

  assert.deepEqual(purged.players.p1.readings, []);
  assert.equal(updatePeaks(store, []).players.p1.twos.rating, 2680);
});

// ---- career bests, from tracker.gg's own "peak-rating" segment ------------

const bestSnap = (h, rating, best, season = "Season 17") => ({
  t: at(h),
  rows: [{ id: "p1", playlists: { d1: { rating, matches: 5, tier: "Supersonic Legend", best: { rating: best, season } } } }],
});

test("a career best above anything seen becomes the published peak, with its season", () => {
  // Zen, 24 September 2026: seen at 1,639 since tracking began, but his 1v1
  // best is 1,808 from Season 17.
  const store = updatePeaks({ players: {} }, [bestSnap(0, 1568, 1808)]);
  const out = peakFor(store, "p1");
  assert.equal(out.ones, 1808);
  assert.deepEqual(out.season, { ones: "Season 17" });
});

test("a career best is not refused as a jump", () => {
  // Far above the current rating is what a soft reset looks like, not a bad row.
  assert.ok(3016 - 1841 > MAX_JUMP);
  const store = updatePeaks({ players: {} }, [bestSnap(0, 1841, 3016)]);
  assert.equal(peakFor(store, "p1").ones, 3016);
});

test("a new high we saw ourselves beats a stale career best, and names no season", () => {
  const store = updatePeaks({ players: {} }, [bestSnap(0, 1850, 1808)]);
  const out = peakFor(store, "p1");
  assert.equal(out.ones, 1850);
  assert.equal(out.season, undefined);
});

test("a career best is never lowered by a later response", () => {
  const first = updatePeaks({ players: {} }, [bestSnap(0, 1568, 1808)]);
  const second = updatePeaks(first, [bestSnap(1, 1568, 1700, "Season 20")]);
  assert.equal(peakFor(second, "p1").ones, 1808);
  assert.deepEqual(peakFor(second, "p1").season, { ones: "Season 17" });
});

test("the peak's date is our own last new high, not the career best", () => {
  const store = updatePeaks({ players: {} }, [bestSnap(0, 1568, 1808)]);
  assert.equal(peakFor(store, "p1").at, new Date(at(0)).toISOString());
});

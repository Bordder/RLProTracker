// Unit tests for the rolling tracker history: retention, folding runs in, and
// presenting readings back in the shape computeTrackerDeltas consumes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { downsampleReadings, collapseUnchanged, appendRows, historyToSnaps, countReadings, HOUR, DAY, FINE_MS, KEEP_MS } from "../scripts/trackerHistory.mjs";

const T = 1_800_000_000_000; // fixed "now"
const at = (ageMs) => ({ t: T - ageMs, playlists: { d2: { rating: 2000, matches: 100 } } });
const row = (id, matches, extra = {}) => ({ id, name: id, team: "T", playlists: { d2: { rating: 2000, matches } }, ...extra });

test("keeps every reading inside the fine window", () => {
  const r = [at(0), at(HOUR), at(10 * HOUR), at(FINE_MS - HOUR)];
  assert.equal(downsampleReadings(r, T).length, 4);
});

test("thins older readings to one per day", () => {
  const r = [at(0)];
  for (let h = 30; h < 24 * 6; h += 3) r.push(at(h * HOUR)); // several per day, 3h apart
  const out = downsampleReadings(r, T);
  const olderDays = out.filter((x) => T - x.t > FINE_MS).map((x) => Math.floor(x.t / DAY));
  assert.equal(new Set(olderDays).size, olderDays.length, "at most one reading per day bucket");
  assert.ok(out.length < r.length / 2, "substantially thinned");
});

test("drops readings past the retention window", () => {
  const out = downsampleReadings([at(0), at(KEEP_MS + DAY)], T);
  assert.equal(out.length, 1);
  assert.equal(out[0].t, T);
});

test("always retains the newest reading even when it is ancient", () => {
  const out = downsampleReadings([at(KEEP_MS + 5 * DAY)], T);
  assert.equal(out.length, 1, "a player who stopped being scraped keeps their last MMR");
});

test("still answers the window lookups after thinning", () => {
  const r = [];
  for (let h = 0; h <= 24 * 15; h++) r.push(at(h * HOUR));
  const out = downsampleReadings(r, T);
  for (const span of [DAY, 7 * DAY, 14 * DAY]) {
    const nearest = out.filter((x) => x.t <= T - span).sort((a, b) => b.t - a.t)[0];
    assert.ok(nearest, `a reading exists at or before ${span / DAY}d ago`);
    assert.ok(T - nearest.t - span <= DAY, "within a day of the window edge");
  }
});

test("appendRows folds a run in and keeps rows without playlists out", () => {
  let h = appendRows({}, T - HOUR, [row("a", 10), { id: "b", name: "b", status: "error" }]);
  assert.deepEqual(Object.keys(h.players), ["a"]);
  h = appendRows(h, T, [row("a", 12)]);
  assert.equal(h.players.a.readings.length, 2);
  assert.equal(h.players.a.readings.at(-1).playlists.d2.matches, 12);
});

test("re-running the same timestamp replaces rather than duplicates", () => {
  let h = appendRows({}, T, [row("a", 10)]);
  h = appendRows(h, T, [row("a", 11)]);
  assert.equal(h.players.a.readings.length, 1);
  assert.equal(h.players.a.readings[0].playlists.d2.matches, 11);
});

test("players missing from a run keep their readings", () => {
  let h = appendRows({}, T - HOUR, [row("a", 10), row("b", 5)]);
  h = appendRows(h, T, [row("a", 12)]);
  assert.equal(h.players.b.readings.length, 1, "b is untouched, not dropped");
  assert.equal(countReadings(h), 3);
});

test("historyToSnaps groups readings by time for the delta core", () => {
  let h = appendRows({}, T - HOUR, [row("a", 10), row("b", 5)]);
  h = appendRows(h, T, [row("a", 12)]);
  const snaps = historyToSnaps(h);
  assert.deepEqual(snaps.map((s) => s.t), [T - HOUR, T]);
  assert.equal(snaps[0].rows.length, 2);
  assert.equal(snaps[1].rows.length, 1);
  assert.equal(snaps[1].rows[0].id, "a");
});

test("collapseUnchanged keeps both ends of an unchanged run", () => {
  const r = [
    { t: 1, playlists: { a: { matches: 10 } } },
    { t: 2, playlists: { a: { matches: 10 } } },
    { t: 3, playlists: { a: { matches: 10 } } },
    { t: 4, playlists: { a: { matches: 12 } } },
  ];
  assert.deepEqual(collapseUnchanged(r).map((x) => x.t), [1, 3, 4]);
});

test("collapseUnchanged preserves the value at any past instant", () => {
  const r = [];
  for (let i = 0; i < 20; i++) r.push({ t: i, playlists: { a: { matches: i < 12 ? 10 : 12 } } });
  const kept = collapseUnchanged(r);
  const at = (rs, t) => [...rs].reverse().find((x) => x.t <= t);
  for (let t = 0; t < 20; t++) {
    assert.equal(at(kept, t).playlists.a.matches, at(r, t).playlists.a.matches, `at t=${t}`);
  }
});

test("collapseUnchanged keeps the gap that dates a finished game", () => {
  const r = [
    { t: 100, playlists: { a: { matches: 5 } } },
    { t: 200, playlists: { a: { matches: 5 } } },
    { t: 300, playlists: { a: { matches: 5 } } },
    { t: 400, playlists: { a: { matches: 6 } } },
  ];
  const kept = collapseUnchanged(r);
  const i = kept.findIndex((x) => x.playlists.a.matches === 6);
  assert.equal(kept[i - 1].t, 300);   // not 100: the session window stays tight
});

test("collapseUnchanged treats a different account as a change", () => {
  const r = [
    { t: 1, who: "steam:1", playlists: { a: { matches: 10 } } },
    { t: 2, who: "epic:x", playlists: { a: { matches: 10 } } },
  ];
  assert.equal(collapseUnchanged(r).length, 2);
});

test("appendRows drops players who are no longer on the roster", () => {
  const history = { players: {
    keep: { name: "Keep", team: "T", readings: [{ t: 1, playlists: { d2: { matches: 1 } } }] },
    gone: { name: "Gone", team: "Departed", readings: [{ t: 1, playlists: { d2: { matches: 1 } } }] },
  } };
  const out = appendRows(history, 2, [], 2, new Set(["keep"]));
  assert.deepEqual(Object.keys(out.players), ["keep"]);
});

test("appendRows without a roster keeps everyone, so a bad read cannot empty the file", () => {
  const history = { players: { a: { name: "A", team: "T", readings: [{ t: 1, playlists: { d2: { matches: 1 } } }] } } };
  assert.deepEqual(Object.keys(appendRows(history, 2, []).players), ["a"]);
});

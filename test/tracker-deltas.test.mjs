// Unit tests for the tracker delta core (computeTrackerPlayers). Pure, no IO.
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTrackerPlayers } from "../scripts/computeTrackerDeltas.mjs";

const HOUR = 3600e3;
const T0 = 1_000_000_000_000;
const T25 = T0 + 25 * HOUR; // 25h later, so d1 window start (now-24h) = T0+1h

// helper: one playlist reading
const pl = (rating, matches) => ({ rating, matches, tier: null });
const row = (id, playlists, name = id, team = "Team") => ({ id, name, team, playlists });

// build the result once from a rich fixture, then assert per player
function run() {
  const snaps = [
    { t: T0, rows: [
      row("full", { d1: pl(1600, 10), d2: pl(1500, 100), d3: pl(1450, 40) }),
      row("reset", { d2: pl(1400, 200) }),
      row("no1v1", { d2: pl(1300, 70), d3: pl(1280, 55) }),
    ] },
    { t: T25, rows: [
      row("full", { d1: pl(1610, 14), d2: pl(1520, 130), d3: pl(1455, 46) }),
      row("reset", { d2: pl(1410, 5) }), // season reset: matches dropped
      row("no1v1", { d2: pl(1310, 90), d3: pl(1285, 61) }),
      row("single", { d2: pl(1400, 50) }), // only appears in the latest snapshot
    ] },
  ];
  const byId = new Map();
  const { now, players } = computeTrackerPlayers(snaps);
  for (const p of players) byId.set(p.id, p);
  return { now, byId };
}

test("now is the latest snapshot time", () => {
  const { now } = run();
  assert.equal(now, T25);
});

test("games diff and latest MMR for a two-reading player", () => {
  const { byId } = run();
  const p = byId.get("full");
  assert.equal(p.mmr.twos, 1520); // latest rating
  assert.equal(p.mmr.ones, 1610);
  assert.equal(p.mmr.threes, 1455);
  // d1 window: only prior reading is T0, so diff spans it (not partial - history exists at/before now-24h)
  assert.deepEqual(p.games.twos.d1, { games: 30, partial: false });
  assert.deepEqual(p.games.ones.d1, { games: 4, partial: false });
  assert.deepEqual(p.games.threes.d1, { games: 6, partial: false });
  // total = sum across playlists
  assert.equal(p.games.total.d1.games, 40);
});

test("seasonGames = cumulative matchesPlayed from the latest reading", () => {
  const { byId } = run();
  const full = byId.get("full"); // latest: ones 14, twos 130, threes 46
  assert.deepEqual(full.seasonGames, { ones: 14, twos: 130, threes: 46, total: 190 });
  const no1v1 = byId.get("no1v1"); // latest: twos 90, threes 61, no 1v1
  assert.equal(no1v1.seasonGames.ones, null);
  assert.equal(no1v1.seasonGames.total, 151); // 90 + 61
  const single = byId.get("single"); // latest: twos 50 only
  assert.equal(single.seasonGames.total, 50);
});

test("season reset clamps negative games to 0", () => {
  const { byId } = run();
  const p = byId.get("reset");
  assert.equal(p.games.twos.d1.games, 0); // 5 - 200 clamped
  assert.equal(p.mmr.twos, 1410);
});

test("single-reading player yields 0 games and partial windows", () => {
  const { byId } = run();
  const p = byId.get("single");
  assert.equal(p.mmr.twos, 1400);
  assert.equal(p.games.twos.d1.games, 0); // can't diff a lone reading
  assert.equal(p.games.twos.d1.partial, true); // no history at/before now-24h
});

test("missing playlist yields null MMR and null games (not zero)", () => {
  const { byId } = run();
  const p = byId.get("no1v1");
  assert.equal(p.mmr.ones, null);
  assert.equal(p.games.ones.d1.games, null);
  // present playlists still counted in total
  assert.equal(p.games.twos.d1.games, 20); // 90 - 70
  assert.equal(p.games.threes.d1.games, 6); // 61 - 55
  assert.equal(p.games.total.d1.games, 26);
});

test("d7/d14 windows without deep history are flagged partial", () => {
  const { byId } = run();
  const p = byId.get("full");
  assert.equal(p.games.twos.d7.partial, true);
  assert.equal(p.games.twos.d14.partial, true);
});

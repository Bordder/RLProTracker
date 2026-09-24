// The Alpha Boost page's developer tracking: links, Casual figures, state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseProfile, pickCasual, lastGames, nextDevState, alphaFeed, loadDevs, pickDevs, steamFeed } from "../scripts/devs.mjs";

test("tracker links parse to platform and id, spaces decoded", () => {
  assert.deepEqual(parseProfile("https://rocketleague.tracker.network/rocket-league/profile/epic/Mr.%20Standards/overview"), { platform: "epic", id: "Mr. Standards" });
  assert.deepEqual(parseProfile("https://rocketleague.tracker.network/rocket-league/profile/steam/76561197977628909/overview"), { platform: "steam", id: "76561197977628909" });
  assert.equal(parseProfile("https://rocketleague.tracker.network/rocket-league/leaderboards"), null);
  assert.equal(parseProfile("https://rocketleague.tracker.network/rocket-league/profile/myspace/x"), null);
});

test("every listed developer link parses", () => {
  const file = JSON.parse(readFileSync("data/devs.json", "utf8"));
  assert.equal(loadDevs(file).length, file.devs.length);
});

const profile = (rating, others = 0) => ({
  data: {
    platformInfo: { platformUserHandle: "Dev" },
    segments: [
      { type: "playlist", metadata: { name: "Ranked Doubles 2v2" }, stats: { rating: { value: 1400 }, matchesPlayed: { value: others } } },
      { type: "playlist", metadata: { name: "Casual" }, stats: { rating: { value: rating }, matchesPlayed: { value: 0 } } },
      { type: "peak-rating", metadata: { name: "Casual" }, stats: {} },
    ],
  },
});

test("Casual rating and handle come out of a profile", () => {
  assert.deepEqual(pickCasual(profile(1100, 3)), { handle: "Dev", steamId: null, rating: 1100 });
  assert.equal(pickCasual({}), null);
});

const m = (playlist, at) => ({ metadata: { playlist, dateCollected: at } });

test("tracker.gg's Multiple entries are Casual games; a reset's bulk stamp is not a game", () => {
  const reset = "2026-09-23T19:27:19.21465+00:00";
  const j = { data: { items: [
    { matches: [m("Multiple", "2026-09-24T03:11:03.435124+00:00"), m("Multiple", "2026-09-24T02:50:20+00:00")] },
    { matches: [m("Ranked Doubles 2v2", "2026-09-24T04:00:00+00:00")] },
    { matches: [m("Casual", reset), m("Hoops", reset), m("Ranked Standard 3v3", reset), m("Snowday", reset)] },
  ] } };
  assert.deepEqual(lastGames(j), { casualAt: "2026-09-24T03:11:03.435Z", seenAt: "2026-09-24T04:00:00.000Z", mode: "Ranked Doubles 2v2" });
  const casualOnly = { data: { items: [{ matches: [m("Multiple", "2026-09-24T03:11:03Z")] }] } };
  assert.equal(lastGames(casualOnly).mode, "Casual", "Multiple is shown as Casual");
  const onlyReset = { data: { items: [{ matches: [m("Casual", reset), m("Hoops", reset), m("Snowday", reset)] }] } };
  assert.deepEqual(lastGames(onlyReset), { casualAt: null, seenAt: null, mode: null });
});

test("the later of tracker.gg's log and our own rating move wins", () => {
  const a = nextDevState(null, pickCasual(profile(1100)), "2026-09-24T10:00:00.000Z", { casualAt: "2026-09-24T09:00:00.000Z", seenAt: "2026-09-24T09:30:00.000Z", mode: "Hoops" });
  assert.equal(a.casualAt, "2026-09-24T09:00:00.000Z");
  assert.equal(a.seenAt, "2026-09-24T09:30:00.000Z");
  assert.equal(a.mode, "Hoops");
  const b = nextDevState(a, pickCasual(profile(1100)), "2026-09-24T10:05:00.000Z", { casualAt: null, seenAt: null });
  assert.equal(b.casualAt, "2026-09-24T09:00:00.000Z", "nothing new, nothing moves");
  const c = nextDevState(b, pickCasual(profile(1091)), "2026-09-24T10:10:00.000Z", null);
  assert.equal(c.casualAt, "2026-09-24T10:10:00.000Z", "a rating move is a game, win or lose");
  assert.equal(c.seenAt, "2026-09-24T10:10:00.000Z");
  assert.equal(c.mode, "Casual", "a Casual rating move is a Casual game");
  const d = nextDevState(c, { handle: null, rating: null }, "2026-09-24T12:00:00.000Z", null);
  assert.equal(d.casualAt, "2026-09-24T10:10:00.000Z", "a missing rating is not a game");
  assert.equal(d.rating, 1091, "and keeps the last rating");
  assert.equal(d.handle, "Dev");
  assert.equal(d.mode, "Casual", "the mode stays with the last game");
});

test("each run reads the never-read first, then the live, then the stalest", () => {
  const devs = ["a", "b", "c", "d"].map((k) => ({ key: k }));
  const now = Date.parse("2026-09-24T12:00:00Z");
  const state = {
    a: { readAt: "2026-09-24T11:00:00Z", seenAt: "2026-09-20T00:00:00Z" },
    b: { readAt: "2026-09-24T11:58:00Z", seenAt: "2026-09-24T11:50:00Z" },
    c: { readAt: "2026-09-24T11:59:00Z" },
    e: { readAt: "2026-09-24T11:30:00Z" },
  };
  devs.push({ key: "e" });
  assert.deepEqual(pickDevs(devs, state, now, 4, { c: { steam: "in" } }).map((d) => d.key), ["d", "b", "c", "a"]);
});

test("the feed names a developer by the profile's handle when devs.json gives none", () => {
  const devs = loadDevs({ devs: [{ tracker: "epic/Retrogue" }, { tracker: "steam/123", name: "Named" }] });
  const f = alphaFeed(devs, { "epic/retrogue": { handle: "Retrogue.", rating: 900 } }, "t");
  assert.deepEqual(f.devs.map((d) => d.name), ["Retrogue.", "Named"]);
  assert.equal(f.devs[1].rating, null);
});

test("Steam presence marks a public profile running Rocket League as in game", () => {
  const devs = loadDevs({ devs: [{ tracker: "steam/76561198053067202" }, { tracker: "steam/bboysca" }, { tracker: "steam/76561197977628909" }, { tracker: "steam/unknownvanity" }, { tracker: "epic/Retrogue" }] });
  const state = { "steam/bboysca": { steamId: "76561198000000001" } };
  const prev = { devs: { "steam/bboysca": { steam: "in", inGameAt: "EARLIER" } } };
  const f = steamFeed(devs, state, [
    { steamid: "76561198053067202", communityvisibilitystate: 3, gameid: "252950" },
    { steamid: "76561198000000001", communityvisibilitystate: 3 },
    { steamid: "76561197977628909", communityvisibilitystate: 1, gameid: "252950" },
  ], prev, "T");
  assert.deepEqual(f.devs, {
    "steam/76561198053067202": { steam: "in", inGameAt: "T" },
    "steam/bboysca": { steam: "out", inGameAt: "EARLIER" },
    "steam/76561197977628909": { steam: "private", inGameAt: null },
  }, "a vanity link uses the profile's id, one never read is skipped, Epic has no Steam");
});

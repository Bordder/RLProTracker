// A refused request is not a finding about the site.
//
// Cloudflare scores the Actions runner as a datacenter client and sometimes
// declines to serve it. The check already knew that and had a whole mechanism
// for it - one retry, a single explanatory note, and a policy of not posting
// when the feeds it DID read were healthy - and the mechanism did nothing,
// because the loop that drives it treated a refusal as an empty document.
//
// The alert that came out of that, on 16 September 2026, said:
//
//   tracker.json: not a JSON object
//   steam-hours.json: not a JSON object
//   mmr-history.json: not a JSON object
//   3 of 6 feeds answered HTTP 403 to this check ... twice.
//
// Every line describes the same three refusals, and the first three describe
// them wrongly: nothing was served, so nothing was or was not a JSON object.
import { test } from "node:test";
import assert from "node:assert/strict";
import { problemsFor, refusalNote } from "../scripts/smokeLive.mjs";

const FEED = { file: "tracker.json", rows: "players", min: 50 };
const NOW = Date.parse("2026-09-16T02:08:00Z");
const refusal = (file, status = 403) => ({ status, refused: true, file, ray: "a3bbfa89780744f6-ATL" });

test("a refused feed contributes no problems", () => {
  assert.deepEqual(problemsFor(FEED, refusal("tracker.json"), NOW), []);
  assert.deepEqual(problemsFor(FEED, refusal("tracker.json", 429), NOW), []);
});

test("a refusal is never reported as a bad document", () => {
  const lines = problemsFor(FEED, refusal("tracker.json"), NOW);
  assert.ok(!lines.some((l) => l.includes("not a JSON object")), lines.join(" | "));
});

test("a transport problem the fetch described is passed through", () => {
  const res = { problems: ["tracker.json: HTTP 502"] };
  assert.deepEqual(problemsFor(FEED, res, NOW), ["tracker.json: HTTP 502"]);
});

test("a feed that was actually served is still audited", () => {
  const stale = { players: new Array(60), computedAt: new Date(NOW - 60 * 60000).toISOString() };
  assert.deepEqual(problemsFor(FEED, { doc: stale }, NOW), ["tracker.json: 60m old"]);

  const good = { players: new Array(60), computedAt: new Date(NOW - 60000).toISOString() };
  assert.deepEqual(problemsFor(FEED, { doc: good }, NOW), []);
});

test("three refusals out of six leave nothing to post and one thing to say", () => {
  const results = [
    refusal("tracker.json"),
    { doc: { teams: new Array(20), computedAt: new Date(NOW).toISOString() } },
    refusal("steam-hours.json"),
    { doc: { players: new Array(60), computedAt: new Date(NOW).toISOString() } },
    refusal("mmr-history.json"),
    { doc: { players: new Array(60), computedAt: new Date(NOW).toISOString() } },
  ];
  const feeds = [
    FEED,
    { file: "team-tracker.json", rows: "teams", min: 10 },
    { file: "steam-hours.json", rows: "players", min: 20, stale: 90 },
    { file: "presence-hours.json", rows: "players", min: 20 },
    { file: "mmr-history.json", rows: "players", min: 20 },
    { file: "tracker.json", rows: "players", min: 50 },
  ];
  const problems = results.flatMap((r, i) => problemsFor(feeds[i], r, NOW));

  // This is the whole point: the run is quiet. Under the old loop `problems`
  // held three invented lines, which is what made the embed fire.
  assert.deepEqual(problems, []);

  const note = refusalNote(results, 6);
  assert.match(note, /^3 of 6 feeds answered HTTP 403 to this check/);
  assert.match(note, /tracker\.json, steam-hours\.json, mmr-history\.json/);
  assert.match(note, /cf-ray a3bbfa89780744f6-ATL/);
});

test("every feed refused is the case that does get said out loud", () => {
  const results = ["a.json", "b.json"].map((f) => refusal(f));
  assert.ok(results.every((r) => r.refused));
  assert.match(refusalNote(results, 2), /^2 of 2 feeds/);
});

// ---- a socket that died is not a broken feed -------------------------------
//
// 22 September 2026. Same run, six feeds: three answered 403, two were served
// correctly, and one never got an answer at all. The alert read:
//
//   Live data check failed
//   - steam-hours.json: could not be reached (fetch failed)
//   - 3 of 6 feeds answered HTTP 403 ...
//
// The refusals behaved: they were counted apart and posted as context. The
// dead socket did not. It was the only line in `problems`, so it alone turned
// a run that had just proved the site was serving into a failure.
//
// A connection that dies before a status code is the same news as a 403. It
// is reported, because a check that could not look at something should say
// so, but it is not a finding about the site.
import { unreachableNote } from "../scripts/smokeLive.mjs";

const dead = (file, error = "fetch failed") => ({ unreachable: true, file, error });

test("a feed that never answered contributes no problems", () => {
  assert.deepEqual(problemsFor(FEED, dead("steam-hours.json"), NOW), []);
});

test("the run that produced the 22 September alert is now quiet", () => {
  const served = { doc: { players: new Array(60), computedAt: new Date(NOW).toISOString() } };
  const results = [
    refusal("tracker.json"),
    served,
    dead("steam-hours.json"),
    refusal("presence-hours.json"),
    served,
    refusal("bracket.json"),
  ];
  const feeds = [
    FEED,
    { file: "team-tracker.json", rows: "players", min: 10 },
    { file: "steam-hours.json", rows: "players", min: 20, stale: 90 },
    { file: "presence-hours.json", rows: "players", min: 20 },
    { file: "mmr-history.json", rows: "players", min: 20 },
    { file: "bracket.json", rows: "events", min: 1 },
  ];
  assert.deepEqual(results.flatMap((r, i) => problemsFor(feeds[i], r, NOW)), []);

  // Two feeds were served correctly, so the site is demonstrably up and this
  // run has nothing to announce. Both notes still exist for the log.
  assert.ok(!results.every((r) => r.refused || r.unreachable));
  assert.match(refusalNote(results, 6), /^3 of 6 feeds answered HTTP 403/);
  assert.match(unreachableNote(results, 6), /^1 of 6 feeds never answered this check/);
  assert.match(unreachableNote(results, 6), /steam-hours\.json/);
  assert.match(unreachableNote(results, 6), /fetch failed/);
});

test("nothing unreachable says nothing", () => {
  assert.equal(unreachableNote([{ doc: {} }, refusal("a.json")], 2), null);
});

test("a run where nothing answered at all is still said out loud", () => {
  const results = ["a.json", "b.json"].map((f) => dead(f));
  assert.ok(results.every((r) => r.refused || r.unreachable));
  assert.match(unreachableNote(results, 2), /^2 of 2 feeds never answered/);
});

test("the two kinds of silence are counted apart", () => {
  const results = [refusal("a.json"), dead("b.json")];
  assert.match(refusalNote(results, 2), /^1 of 2 feeds answered HTTP 403/);
  assert.doesNotMatch(refusalNote(results, 2), /b\.json/);
  assert.match(unreachableNote(results, 2), /^1 of 2 feeds never answered/);
  assert.doesNotMatch(unreachableNote(results, 2), /a\.json/);
});

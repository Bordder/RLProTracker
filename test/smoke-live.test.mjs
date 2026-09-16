// The live check's judgement, without the live site.
//
// The fetching half is trivial and untestable without a network; the half
// worth testing is what counts as a problem. Every case here is a failure that
// actually happened and was found by eye rather than by machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { auditFeed, auditBracket } from "../scripts/smokeLive.mjs";

const NOW = Date.parse("2026-09-15T21:00:00Z");
const ago = (min) => new Date(NOW - min * 60000).toISOString();

const tracker = { file: "tracker.json", rows: "players", min: 50 };
const bracket = { file: "bracket.json", rows: "events", min: 1 };
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

test("a healthy feed reports nothing", () => {
  assert.deepEqual(auditFeed(tracker, { computedAt: ago(2), players: players(104) }, NOW), []);
});

test("a stopped collector is named with its age", () => {
  const [problem] = auditFeed(tracker, { computedAt: ago(140), players: players(104) }, NOW);
  assert.match(problem, /tracker\.json: 2\.3h old/);
});

test("a feed keyed by id counts its entries, not its length", () => {
  // mmr-history lists players as an object. Reading that as an array said
  // "no players array" for a feed that was serving 104 of them.
  const feed = { file: "mmr-history.json", rows: "players", min: 20 };
  const byId = Object.fromEntries(players(104).map((p) => [p.id, { mmr: [] }]));
  assert.deepEqual(auditFeed(feed, { computedAt: ago(1), players: byId }, NOW), []);
});

test("an empty board is a problem even when it is fresh", () => {
  const [problem] = auditFeed(tracker, { computedAt: ago(1), players: [] }, NOW);
  assert.match(problem, /0 players, expected at least 50/);
});

// ---- the bracket, which fails in ways freshness cannot see -----------------

const ev = (over = {}) => ({
  slug: "worlds-2026",
  name: "RLCS 2026 World Championship",
  starts: "2026-09-15",
  ends: "2026-09-20",
  counts: { matches: 2, played: 1, live: 1, upcoming: 0 },
  stages: [{
    brackets: [{
      matches: [
        { teams: ["Virtus.pro", "Bigodes"], scores: [3, 0], finished: true, live: false, upcoming: false },
        { teams: ["R8 Esports", "Bigodes"], scores: [0, 1], finished: false, live: true, upcoming: false },
      ],
    }],
    matchlists: [],
  }],
  ...over,
});

const doc = (over = {}, evOver = {}) => ({ generatedAt: ago(2), events: [ev(evOver)], ...over });

test("a bracket mid-event with nothing wrong reports nothing", () => {
  assert.deepEqual(auditBracket(doc(), NOW), []);
});

test("a frozen bracket is only a problem while the event is on", () => {
  // Three hours stale during the play-in: the 15 September failure.
  const [problem] = auditBracket(doc({ generatedAt: ago(180) }), NOW);
  assert.match(problem, /3\.0h old while RLCS 2026 World Championship is being played/);

  // The same age between events is correct, not a fault: the collector
  // deliberately fetches nothing outside an event window.
  const past = doc({ generatedAt: ago(180) }, { starts: "2025-09-15", ends: "2025-09-20" });
  assert.deepEqual(auditBracket(past, NOW), []);
});

test("a match in two states at once is caught", () => {
  const d = doc();
  d.events[0].stages[0].brackets[0].matches[1].finished = true;   // live AND finished
  const [problem] = auditBracket(d, NOW);
  assert.match(problem, /R8 Esports vs Bigodes is in 2 states/);
});

test("a finished series cannot be a draw", () => {
  const d = doc();
  d.events[0].stages[0].brackets[0].matches[0].scores = [2, 2];
  const [problem] = auditBracket(d, NOW);
  assert.match(problem, /finished 2-2, a draw/);
});

test("a team still wearing its Liquipedia code is reported", () => {
  const [problem] = auditBracket(doc({}, { unresolved: ["kc", "g2s"] }), NOW);
  assert.match(problem, /worlds-2026: unresolved team names kc, g2s/);
});

test("counts that do not add up are reported", () => {
  const [problem] = auditBracket(doc({}, { counts: { matches: 47, played: 9, live: 0, upcoming: 0 } }), NOW);
  assert.match(problem, /counts say 9 of 47 matches/);
});

test("an hourly feed is judged on its own cadence", () => {
  // steam.yml is dispatched at :07, so a healthy steam-hours.json is routinely
  // 50 minutes old. The first live run of this check called that stale.
  const hourly = { file: "steam-hours.json", rows: "players", min: 20, stale: 90 };
  assert.deepEqual(auditFeed(hourly, { computedAt: ago(50), players: players(40) }, NOW), []);

  const [problem] = auditFeed(hourly, { computedAt: ago(200), players: players(40) }, NOW);
  assert.match(problem, /steam-hours\.json: 3\.3h old/);
});

// ---- refused is not down ---------------------------------------------------

import { refusalNote } from "../scripts/smokeLive.mjs";

const refusal = (status = 403, file = "tracker.json", ray = null) => ({ status, file, ray, refused: true });

test("every feed refused with the same status is reported as one refusal", () => {
  // The 15 September alarm: six lines saying "HTTP 403", which reads as the
  // data being down. Every feed was serving correctly to browsers; Cloudflare
  // had refused the runner.
  const all = Array.from({ length: 6 }, (_, i) => refusal(403, `feed${i}.json`, "9abc-LHR"));
  const line = refusalNote(all, 6);
  assert.match(line, /6 of 6 feeds answered HTTP 403/);
  assert.match(line, /being turned away rather than the site being down/);
  assert.match(line, /cf-ray 9abc-LHR/);
});

test("a partial refusal is still a refusal", () => {
  // 16 September: three feeds refused and three served, in one run. The
  // all-or-nothing version said nothing and the three refusals were posted as
  // three dead feeds.
  const mixed = [refusal(403, "tracker.json"), refusal(403, "steam-hours.json"), { doc: {} }, { doc: {} }];
  const line = refusalNote(mixed, 4);
  assert.match(line, /2 of 4 feeds answered HTTP 403 to this check \(tracker\.json, steam-hours\.json\)/);
});

test("a 502 is the site's problem, not a refusal", () => {
  // The case this check was written for, and it must not be softened into
  // "we were probably blocked" however many feeds report it.
  const down = Array.from({ length: 6 }, () => ({ status: 502, problems: ["x: HTTP 502"] }));
  assert.equal(refusalNote(down, 6), null);
});

test("nothing refused says nothing", () => {
  assert.equal(refusalNote([{ doc: {} }, { doc: {} }], 2), null);
});

test("mixed refusal statuses are named together", () => {
  const both = [refusal(403, "a.json"), refusal(429, "b.json")];
  assert.match(refusalNote(both, 2), /HTTP 403\/429/);
});

test("a refusal with no ray still reports", () => {
  assert.match(refusalNote([refusal(429, "a.json")], 2), /1 of 2 feeds answered HTTP 429/);
  assert.doesNotMatch(refusalNote([refusal(429, "a.json")], 2), /cf-ray/);
});

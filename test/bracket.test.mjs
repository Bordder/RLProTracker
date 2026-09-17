// node --test rlcs-bracket/test.mjs
//
// Fixtures are real pages: Worlds with every score still empty and a finished
// regional with 160 filled scores, both captured 11 September 2026, and Worlds
// again at 18:21 on 15 September with two series being played. The lifecycle
// has three states and a fixture for each, which is the only honest way to
// test a wikitext parser - the middle one exists only while a LAN is on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parsePage, parseDate, parseDay, splitArgs, findTemplates, parseBrackets } from "../scripts/parseBracket.mjs";
import { pollPlan, perHour, MINUTE, LIVE, IDLE, EVENT_DAY } from "../scripts/bracketSchedule.mjs";
import { teamsFromRender } from "../scripts/resolveTeams.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// Wikitext fixtures and the bracket shapes live with the rest of the
// project's data, not beside the test.
const BRACKET = join(HERE, "..", "data", "bracket");
const fixture = (f) => readFileSync(join(BRACKET, "fixtures", f), "utf8");
const worlds = parsePage(fixture("worlds-2026.wikitext"));
const regional = parsePage(fixture("regional-finished.wikitext"));
// The play-in, 18:21 UTC on 15 September: four series done, Virtus.pro 2-1 up
// on Mate y Tapa and Bigodes 2-1 up on Five Fears, both still playing.
const midseries = parsePage(fixture("worlds-midseries.wikitext"));

test("splitArgs breaks on top-level pipes only", () => {
  assert.deepEqual(splitArgs("Match|a=1|b={{X|y=2}}|c=3").length, 4);
  // The date value contains {{Abbr/CET}}, whose pipe-free body still nests.
  assert.deepEqual(splitArgs("Match|date=Nov 15 {{Abbr/CET}}|f=t").length, 3);
});

test("template matching is case-insensitive, as MediaWiki is", () => {
  // The Worlds page writes {{matchlist}} in lower case and every other page
  // writes {{Matchlist}}. Matching case-sensitively dropped the entire group
  // stage while the page still looked plausible.
  assert.equal(findTemplates("{{matchlist|id=a}}", "Matchlist").length, 1);
  assert.equal(findTemplates("{{Matchlist|id=a}}", "matchlist").length, 1);
});

test("a search for Match does not match Matchlist", () => {
  assert.equal(findTemplates("{{Matchlist|id=a}}", "Match").length, 0);
});

test("every match on the Worlds page is found", () => {
  // 47 is the count of {{Match blocks in the raw wikitext: 23 in two brackets
  // plus 24 across four group lists. A parser that finds fewer is dropping a
  // stage silently.
  assert.equal(worlds.counts.matches, 47);
  assert.equal(worlds.brackets.length, 2);
  assert.equal(worlds.matchlists.length, 4);
});

test("an empty score is upcoming, never nil-nil", () => {
  // The whole Worlds page is in this state until the event starts. Rendering
  // it as 0-0 would show a completed tournament nobody won.
  assert.equal(worlds.counts.played, 0);
  assert.equal(worlds.counts.upcoming, 47);
  for (const m of worlds.brackets[0].matches) {
    assert.deepEqual(m.scores, [null, null]);
    assert.equal(m.upcoming, true);
  }
});

test("a finished bracket reads its real scores", () => {
  assert.equal(regional.counts.matches, 80);
  assert.ok(regional.counts.played >= 79, `expected nearly all played, got ${regional.counts.played}`);
  const first = regional.brackets[0].matches[0];
  assert.deepEqual(first.teams, ["m8", "whatever."]);
  assert.deepEqual(first.scores, [3, 0]);
  assert.equal(first.finished, true);
});

test("round and position come from the R<n>M<n> key", () => {
  for (const b of [...worlds.brackets, ...regional.brackets]) {
    for (const m of b.matches) {
      assert.ok(Number.isInteger(m.round) && m.round >= 1);
      assert.ok(Number.isInteger(m.position) && m.position >= 1);
    }
  }
});

test("undrawn group slots stay null rather than inventing a team", () => {
  // Worlds groups are not drawn yet: {{TeamOpponent||score=}}.
  assert.deepEqual(worlds.matchlists[0].matches[0].teams, [null, null]);
});

test("dates convert to a real instant in UTC", () => {
  assert.equal(parseDate("November 15, 2025 - 18:45 {{Abbr/CET}}"), "2025-11-15T17:45:00.000Z");
  assert.equal(parseDate("September 15, 2026 - 11:00 {{Abbr/CDT}}"), "2026-09-15T16:00:00.000Z");
  // Liquipedia writes both shapes, and on the 2026 Worlds page it uses both at
  // once: prose in the brackets, this one in the group matchlists. Reading
  // only the prose form left every group match of a scheduled day undated.
  assert.equal(parseDate("2026-09-16 11:00 {{Abbr/CDT}}"), "2026-09-16T16:00:00.000Z");
  assert.equal(parseDate("2026-09-17 15:20 {{Abbr/CDT}}"), "2026-09-17T20:20:00.000Z");
});

test("a date with no time keeps the day", () => {
  // The playoff and 1v1 finals are dated but not timed. That is not a kickoff,
  // so parseDate refuses it; the day is still worth publishing.
  assert.equal(parseDay("September 18, 2026"), "2026-09-18");
  assert.equal(parseDay("2026-09-16 11:00 {{Abbr/CDT}}"), "2026-09-16");
  assert.equal(parseDay("soon"), null);
  assert.equal(parseDay(""), null);
});

test("an unparseable or unknown-zone date is null, not a guess", () => {
  // A wrong kickoff time is worse than none: the page can say TBD.
  assert.equal(parseDate(""), null);
  assert.equal(parseDate("sometime tuesday"), null);
  assert.equal(parseDate("November 15, 2025 - 18:45 {{Abbr/XYZ}}"), null);
});

// ---- polling cadence ------------------------------------------------------

const at = (iso) => Date.parse(iso);
const m = (iso, upcoming = true) => ({ startsAt: iso, upcoming });

test("a match under way polls every minute", () => {
  const plan = pollPlan([m("2026-09-15T16:00:00Z")], at("2026-09-15T16:20:00Z"));
  assert.equal(plan.state, "live");
  assert.equal(plan.everyMs, LIVE);
});

test("polling stays slow when no match is running", () => {
  // Three days before the event: nothing should be hammering Liquipedia.
  const plan = pollPlan([m("2026-09-15T16:00:00Z")], at("2026-09-12T09:00:00Z"));
  assert.equal(plan.state, "idle");
  assert.equal(plan.everyMs, IDLE);
});

test("the fast cadence starts shortly before the first match", () => {
  const plan = pollPlan([m("2026-09-15T16:00:00Z")], at("2026-09-15T15:55:00Z"));
  assert.equal(plan.state, "warmup");
  assert.equal(plan.everyMs, LIVE);
});

test("later the same day is a middling cadence, not a fast one", () => {
  const plan = pollPlan([m("2026-09-15T22:00:00Z")], at("2026-09-15T09:00:00Z"));
  assert.equal(plan.state, "event-day");
  assert.equal(plan.everyMs, EVENT_DAY);
});

test("a long-finished match does not hold the fast cadence open forever", () => {
  // Without this the collector polls every minute indefinitely whenever a page
  // stops being updated mid-event.
  const plan = pollPlan([m("2026-09-15T16:00:00Z")], at("2026-09-15T23:00:00Z"));
  assert.notEqual(plan.state, "live");
});

test("a fully played page goes quiet", () => {
  const plan = pollPlan([m("2026-09-15T16:00:00Z", false)], at("2026-09-15T16:10:00Z"));
  assert.equal(plan.state, "done");
  assert.equal(plan.everyMs, IDLE);
});

test("the fastest cadence stays far inside Liquipedia's limit", () => {
  // They allow 1 request per 2 seconds, which is 1,800 an hour. Being an order
  // of magnitude under that is the point.
  const live = pollPlan([m("2026-09-15T16:00:00Z")], at("2026-09-15T16:05:00Z"));
  assert.equal(perHour(live), 60);
  assert.ok(perHour(live) <= 1800 / 10);
});

test("the real Worlds page schedules sensibly before the event", () => {
  const all = worlds.stages ? [] : [...worlds.brackets.flatMap((b) => b.matches), ...worlds.matchlists.flatMap((l) => l.matches)];
  const plan = pollPlan(all, at("2026-09-11T12:00:00Z"));
  assert.equal(plan.state, "idle", "four days out should not be polling fast");
  const during = pollPlan(all, at("2026-09-15T16:30:00Z"));
  assert.equal(during.state, "live", "mid-session should be live");
});

test("round labels come from the wikitext comments", () => {
  // Liquipedia writes "<!-- Upper Bracket Quarterfinals -->" above each group
  // of slots. Those labels are the structure: without them R1 of the Play-In
  // is one nonsensical column of six matches rather than two blocks.
  const labels = [...new Set(worlds.brackets[0].matches.map((m) => m.label))];
  assert.ok(labels.includes("Upper Bracket Quarterfinals"), labels.join(" / "));
  assert.ok(labels.includes("Lower Bracket Quarterfinals"), labels.join(" / "));
});

test("upper and lower are separated, which is what makes round 1 make sense", () => {
  const r1 = worlds.brackets[0].matches.filter((m) => m.round === 1);
  assert.equal(r1.length, 6, "six matches share R1");
  assert.equal(r1.filter((m) => m.section === "upper").length, 4);
  assert.equal(r1.filter((m) => m.section === "lower").length, 2);
});

test("separating the sections makes the pairing clean", () => {
  // 4 upper quarterfinals into 2 upper semifinals is a clean binary step, so
  // connectors can be drawn. Mixed with the lower bracket it is 6 into 4,
  // which is not, and no connector was drawn at all.
  const b = worlds.brackets[0];
  const upper = (r) => b.matches.filter((m) => m.section === "upper" && m.round === r).length;
  assert.equal(upper(1), 4);
  assert.equal(upper(2), 2);
});

test("group matches carry their round heading", () => {
  const labels = worlds.matchlists[0].matches.map((m) => m.label).filter(Boolean);
  assert.deepEqual(labels, ["Round 1", "Round 2", "Round 3"]);
});

test("round labels ignore comments nested inside a match", () => {
  // Liquipedia writes the map name as a comment inside each {{Map}}, so a flat
  // scan for comments labelled two rounds of the Boston Major "Champions
  // Field". Only top-level comments are round labels.
  const major = parsePage(fixture("boston-major.wikitext"));
  const labels = new Set(major.brackets[0].matches.map((m) => m.label));
  assert.ok(!labels.has("Champions Field"), [...labels].join(" / "));
  assert.ok(labels.has("Grand Final"), [...labels].join(" / "));
});

test("a real finished Major parses end to end", () => {
  const major = parsePage(fixture("boston-major.wikitext"));
  assert.equal(major.counts.matches, 33);
  assert.equal(major.counts.upcoming, 0, "every match of a finished event is played");
  const gf = major.brackets[0].matches.find((m) => m.label === "Grand Final");
  assert.ok(gf, "the grand final should be found");
  assert.ok(gf.scores.every((s) => s !== null), "the grand final has a result");
});

// ---- event windows --------------------------------------------------------

import { inWindow, eventsDue, allMatches, loadEvents, PAD } from "../scripts/events.mjs";

const worldsEvent = { slug: "worlds-2026", starts: "2026-09-15", ends: "2026-09-20" };

test("an event is followed inside its dates", () => {
  assert.equal(inWindow(worldsEvent, at("2026-09-15T16:00:00Z")), true);
  assert.equal(inWindow(worldsEvent, at("2026-09-18T03:00:00Z")), true);
});

test("the last day is included in full", () => {
  // `ends` is a date, not an instant. Treating it as midnight would stop
  // following the event on the morning of the grand final.
  assert.equal(inWindow(worldsEvent, at("2026-09-20T23:00:00Z")), true);
});

test("the window is padded a day either side for timezones", () => {
  // Fort Worth is UTC-5: the "15 September" first match is the 15th UTC, but
  // late sessions run past midnight UTC into the next day.
  assert.equal(inWindow(worldsEvent, at("2026-09-14T22:00:00Z")), true);
  assert.equal(inWindow(worldsEvent, at("2026-09-21T12:00:00Z")), true);
});

test("an event long past or far off costs no requests", () => {
  assert.equal(inWindow(worldsEvent, at("2026-09-10T12:00:00Z")), false);
  assert.equal(inWindow(worldsEvent, at("2026-09-25T12:00:00Z")), false);
  assert.equal(PAD, 86400e3);
});

test("only the running event is due, not the whole list", () => {
  const events = [
    { slug: "boston", starts: "2026-02-19", ends: "2026-02-22" },
    worldsEvent,
  ];
  const due = eventsDue(events, at("2026-09-16T18:00:00Z"));
  assert.deepEqual(due.map((e) => e.slug), ["worlds-2026"]);
});

test("events.json is loadable, and every cache file it names exists", async () => {
  // The collector reads the cache by filename; a typo here is a crash at the
  // worst possible moment rather than at startup. Names and dates are NOT
  // checked, deliberately - they come from each page's own infobox now, so
  // requiring them here would be requiring the duplication this removed.
  const { readFileSync } = await import("node:fs");
  const events = await loadEvents();
  assert.ok(events.length >= 1);
  const slugs = new Set();
  for (const e of events) {
    assert.ok(e.slug, "an event has no slug");
    assert.ok(!slugs.has(e.slug), `${e.slug} appears twice`);
    slugs.add(e.slug);
    for (const t of e.titles) {
      assert.ok(t.title && t.cache, `${e.slug} has an incomplete title entry`);
      // The FIXTURE, not the cache.
      //
      // readCached prefers cache/ and falls back to fixtures/, so accepting
      // either looked equivalent. It is not: cache/ is gitignored, live and
      // disposable, so it exists on a machine that has run the collector and
      // nowhere else. This assertion passed locally off a file no one else
      // has and failed on every clean checkout, which is how CI sat red for
      // 23 runs from 15 September while `npm test` was green on the desk it
      // was written at.
      //
      // Requiring the committed copy makes the two agree: what CI checks is
      // what a fresh clone checks.
      const found = (() => {
        try { readFileSync(join(BRACKET, "fixtures", t.cache)); return true; } catch { return false; }
      })();
      assert.ok(found, `${e.slug}: no committed fixture for ${t.cache}. ` +
        `Copy data/bracket/cache/${t.cache} to data/bracket/fixtures/ and commit it.`);
    }
  }
});

test("every event on the page can name itself", async () => {
  // A chip with no name is a chip nobody can click on purpose. The name comes
  // from the infobox, so this is really a check that each cached page HAS one.
  const { parseEvent } = await import("../scripts/assemble.mjs");
  for (const e of await loadEvents()) {
    const parsed = await parseEvent(e);
    assert.ok(parsed.name && parsed.name !== e.slug, `${e.slug} has no name from its page`);
    assert.ok(parsed.starts && parsed.ends, `${e.slug} has no dates from its page`);
  }
});

test("allMatches flattens brackets and group lists together", () => {
  // pollPlan sees one list. A group match starting before any bracket match
  // must still be able to set the cadence.
  const flat = allMatches([worlds]);
  assert.equal(flat.length, worlds.counts.matches);
});

// ---- the infobox: events describe themselves -----------------------------

import { parseInfobox } from "../scripts/parseBracket.mjs";

test("an event's name, place and dates come from its own page", () => {
  const i = parseInfobox(fixture("worlds-2026.wikitext"));
  assert.equal(i.name, "RLCS 2026 World Championship");
  assert.equal(i.city, "Fort Worth");
  assert.equal(i.venue, "Dickies Arena");
  assert.equal(i.starts, "2026-09-15");
  assert.equal(i.ends, "2026-09-20");
  assert.equal(i.teamCount, 20);
});

test("a two-letter country is a code, and is shown as one", () => {
  // Some pages write "us" where others write "United States".
  assert.equal(parseInfobox(fixture("boston-major.wikitext")).country, "US");
  assert.equal(parseInfobox(fixture("worlds-2026.wikitext")).country, "United States");
});

test("wiki markup is stripped out of infobox values", () => {
  // venue is written "[https://kbhallen.dk/ K.B Hallen Arena]" on one page and
  // "Copper Box Arena |venuelink=https://..." on another: a link, and a field
  // that runs into the next one.
  const major = parseInfobox(fixture("boston-major.wikitext"));
  assert.equal(major.venue, "Agganis Arena");
  assert.ok(!/[[\]|=]|https?:/.test(major.venue ?? ""), major.venue);
});

test("a page with no infobox gives an empty object, not a crash", () => {
  assert.deepEqual(parseInfobox("{{Match|opponent1={{TeamOpponent|m8}}}}"), {});
});

test("parsePage carries the infobox alongside the matches", () => {
  // This is what lets events.json stay four lines per event.
  assert.equal(worlds.info.name, "RLCS 2026 World Championship");
  assert.equal(worlds.info.prizePool, "1,200,000");
});

// ---- bracket shapes: the real edge list ----------------------------------

import { parseShape, slotKey, feedersOf } from "../scripts/shape.mjs";

const SHAPE = `
{{TemplateMatch|matchid=R01-M001|header=!u4!x}}
{{TemplateMatch|matchid=R01-M002}}
{{TemplateMatch|matchid=R02-M001|root=true|toupper=R01-M001|tolower=R01-M002|qualwin=true}}
{{TemplateMatch|matchid=R01-M005|header=!l4!x}}
{{TemplateMatch|matchid=R02-M003|root=true|tolower=R01-M005|qualwin=true}}
`;

test("a commons matchid becomes the key the page already uses", () => {
  assert.equal(slotKey("R01-M001"), "R1M1");
  assert.equal(slotKey("R12-M034"), "R12M34");
  assert.equal(slotKey("nonsense"), null);
});

test("toupper and tolower are the edge list", () => {
  const shape = parseShape(SHAPE);
  assert.deepEqual(shape.edges.R2M1, { upper: "R1M1", lower: "R1M2", qualifies: true });
  assert.deepEqual(feedersOf(shape, "R2M1"), ["R1M1", "R1M2"]);
});

test("a match fed by one other is not a match fed by none", () => {
  // The lower bracket receiving a single match is the case the old halving
  // heuristic could not express at all, and the case it got wrong silently.
  const shape = parseShape(SHAPE);
  assert.deepEqual(feedersOf(shape, "R2M3"), ["R1M5"]);
});

test("a play-in marks the matches whose winner qualifies", () => {
  // The whole point of a play-in, and the column Liquipedia draws on the
  // right of one. Without it the bracket stops after the semifinals and
  // never says who got through.
  const play = JSON.parse(readFileSync(join(BRACKET, "shapes.json"), "utf8"))["Bracket/8-2Q-U-4L2D-2Q"];
  const qual = Object.entries(play.edges).filter(([, e]) => e.qualifies).map(([k]) => k);
  assert.deepEqual(qual.sort(), ["R2M1", "R2M2", "R2M3", "R2M4"]);
});

test("a first-round match is present with no feeders", () => {
  // Present, so the page can tell "no edges here" from "never fetched".
  const shape = parseShape(SHAPE);
  assert.deepEqual(shape.edges.R1M1, { upper: null, lower: null, qualifies: false });
  assert.deepEqual(feedersOf(shape, "R1M1"), []);
  assert.deepEqual(feedersOf(shape, "R9M9"), []);
});

test("the real Worlds playoff shape is not a binary tree", () => {
  // 4, 2, 4, 2, 1 as the lower bracket merges in. This is exactly why the
  // shape has to be read rather than inferred.
  const shape = JSON.parse(readFileSync(join(BRACKET, "shapes.json"), "utf8"))["Bracket/2-2-U-8L4DS"];
  assert.ok(shape, "the Worlds playoff shape should be cached");
  assert.deepEqual(shape.edges.R2M1, { upper: "R1M1", lower: "R1M2", qualifies: false });
  assert.deepEqual(shape.edges.R3M3, { upper: null, lower: "R2M1", qualifies: false });
});

// ---- group standings ------------------------------------------------------

import { records, standings, pairGroups } from "../web/standings.mjs";

const played = (a, b, x, y) => ({ teams: [a, b], scores: [x, y], upcoming: false });

test("a record counts series and games, not matches on the page", () => {
  const r = records([played("A", "B", 3, 1), played("A", "C", 3, 0), played("B", "C", 2, 3)]);
  assert.deepEqual(
    { ...r.get("a") },
    { team: "A", won: 2, lost: 0, played: 2, gamesFor: 6, gamesAgainst: 1, diff: 5 }
  );
});

test("an unplayed match is not a nil-nil draw", () => {
  const r = records([{ teams: ["A", "B"], scores: [null, null], upcoming: true }]);
  assert.equal(r.size, 0);
});

test("a team is the same team whatever an editor capitalised", () => {
  // Boston Major: the table says "Ninjas In Pyjamas", its own matches say
  // "Ninjas in Pyjamas". Keyed literally, that team shows 0-0 beside three
  // matches it played.
  const r = records([played("Ninjas in Pyjamas", "PWR", 3, 1), played("Ninjas In Pyjamas", "NRG", 1, 3)]);
  assert.equal(r.size, 3);
  assert.equal(r.get("ninjas in pyjamas").played, 2);
});

test("the listed row order is not the finishing order", () => {
  // The Paris Major Group A lists Team Vitality first and marks Karmine Corp
  // bg2=up; Karmine Corp went 3-0 and won the group. The wikitext order is
  // what an editor typed, and Liquipedia sorts by results when it renders.
  // Trusting it put the group winner second on this page.
  const table = { title: "Group A", rows: [
    { rank: 1, team: "Team Vitality", outcome: "stay", meansIfHere: "up" },
    { rank: 2, team: "Karmine Corp", outcome: "up", meansIfHere: "stay" },
  ] };
  const rows = standings(table, [
    played("Karmine Corp", "Team Vitality", 3, 1),
    played("Karmine Corp", "Wildcard", 3, 0),
    played("Team Vitality", "Wildcard", 3, 2),
  ]);
  assert.deepEqual(rows.map((r) => r.team), ["Karmine Corp", "Team Vitality"]);
  assert.equal(rows[0].outcome, "up", "the outcome follows the team");
  assert.equal(rows[0].meansIfHere, "up", "what a PLACE means follows the place");
});

test("a tie keeps the listed order rather than reshuffling", () => {
  const table = { title: "G", rows: [
    { rank: 1, team: "A", outcome: null, meansIfHere: "up" },
    { rank: 2, team: "B", outcome: null, meansIfHere: "down" },
  ] };
  const rows = standings(table, []);
  assert.deepEqual(rows.map((r) => r.team), ["A", "B"]);
});

test("an undrawn group still says what each place will mean", () => {
  // The Worlds groups are rows of team=tbd with pbg1=up. "First advances" is
  // the most useful thing a table can say before a ball is hit.
  const worldsTables = worlds.tables;
  assert.equal(worldsTables.length, 4);
  const rows = standings(worldsTables[0], []);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].team, null);
  assert.equal(rows[0].meansIfHere, "up");
  assert.equal(rows[0].outcome, null, "nothing has happened yet");
});

test("with no table at all, standings are ordered by result", () => {
  // Series first: C wins two and tops it. A and B win one each, and A takes
  // second on game difference (+2 against B's -3), which is the documented
  // third tiebreaker and the only one derivable from results alone.
  const rows = standings(null, [
    played("A", "B", 3, 0),
    played("C", "A", 3, 2),
    played("C", "B", 3, 1),
  ]);
  assert.deepEqual(rows.map((r) => r.team), ["C", "A", "B"]);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3]);
  assert.deepEqual(rows.map((r) => r.diff), [3, 2, -5]);
});

test("each group table pairs with its own match list", () => {
  // Titled "Group A" and "Group A Matches".
  const pairs = pairGroups(worlds.tables, worlds.matchlists);
  assert.equal(pairs.length, 4);
  for (const { list, table } of pairs) {
    assert.ok(table, `${list.title} found no table`);
    assert.ok(list.title.startsWith(table.title), `${list.title} paired with ${table.title}`);
  }
});

// A 1v1 event names a player where a team event names a team. Both are
// opponents and both have to parse, or a whole bracket reads as undrawn while
// the draw has in fact been made.
test("a solo opponent is an opponent", () => {
  const wikitext = `{{Bracket|Bracket/4|id=x
|R1M1={{Match
    |opponent1={{SoloOpponent|Nwpo|score=4}}
    |opponent2={{SoloOpponent|kv1|score=2}}
    |finished=t
}}
}}`;
  const [bracket] = parseBrackets(wikitext);
  assert.deepEqual(bracket.matches[0].teams, ["Nwpo", "kv1"]);
  assert.deepEqual(bracket.matches[0].scores, [4, 2]);
});


// A Bo5 at 2-1 is not over. Liquipedia writes the score in as each game is
// played and only sets finished= when the series ends, so reading "has a
// score" as "has a winner" put Virtus.pro through the play-in on 15 September
// while the fourth game was being played.
test("a series in progress has no winner", () => {
  const wikitext = `{{Bracket|Bracket/4|id=x
|R1M1={{Match
    |opponent1={{TeamOpponent|vp|score=2}}
    |opponent2={{TeamOpponent|Mate y Tapa|score=1}}
}}
|R1M2={{Match
    |opponent1={{TeamOpponent|Team Falcons|score=3}}
    |opponent2={{TeamOpponent|FUT Esports|score=1}}
    |finished=true
}}
}}`;
  const [bracket] = parseBrackets(wikitext);
  const [live, done] = bracket.matches;

  assert.equal(live.finished, false, "2-1 with no flag is still being played");
  assert.equal(live.live, true);
  assert.equal(live.upcoming, false, "it has started, so it is not upcoming either");
  assert.deepEqual(live.scores, [2, 1], "the running score is still reported");

  assert.equal(done.finished, true);
  assert.equal(done.live, false);
  assert.equal(done.upcoming, false);
});

// The map names are in the wikitext after all: the {{Map}} block carries its
// own map= field. An earlier pass concluded they lived only in Liquipedia's
// database and the card drew goal scores with nothing to name them.
test("a map keeps its name alongside its goals", () => {
  const wikitext = `{{Bracket|Bracket/4|id=x
|R1M1={{Match
    |opponent1={{TeamOpponent|vp|score=1}}
    |opponent2={{TeamOpponent|Mate y Tapa|score=0}}
    |map1={{Map|map=Mannfield (Dusk)|score1=0|score2=1}}
    |map2={{Map|map=Forbidden Temple|score1=2|score2=0}}
    |map3={{Map|map=|score1=|score2=}}
    |finished=true
}}
}}`;
  const [bracket] = parseBrackets(wikitext);
  const maps = bracket.matches[0].maps;
  assert.equal(maps[0].name, "Mannfield (Dusk)");
  assert.deepEqual([maps[1].name, maps[1].score1, maps[1].score2], ["Forbidden Temple", 2, 0]);
  assert.equal(maps[2].name, null, "an unplayed slot names nothing rather than guessing");
});

// ---- the play-in, captured while it was being played ----------------------
//
// This fixture is the state that broke the site on 15 September and the one
// neither other fixture can hold: a page with finished series, series in
// progress, and series not started, all at once. It was captured at 18:21,
// three minutes before the wikitext moved on, and it cannot be recaptured
// once the event is over.

const midMatches = [
  ...midseries.brackets.flatMap((b) => b.matches),
  ...midseries.matchlists.flatMap((m) => m.matches),
];
const byTeams = (a, b) =>
  midMatches.find((m) => m.teams[0] === a && m.teams[1] === b);

test("a half-played page counts all three states", () => {
  assert.deepEqual(midseries.counts, { matches: 47, played: 4, live: 2, upcoming: 41 });
  // Every match is in exactly one state, which is what makes the counts add up.
  for (const m of midMatches) {
    const states = [m.finished, m.live, m.upcoming].filter(Boolean);
    assert.equal(states.length, 1, `${m.teams.join(" vs ")} is in ${states.length} states`);
  }
});

test("a Bo5 at 2-1 has a score and no winner", () => {
  const m = byTeams("vp", "Mate y Tapa");
  assert.ok(m, "the upper bracket semifinal is on the page");
  assert.deepEqual(m.scores, [2, 1]);
  assert.equal(m.finished, false, "nobody has reached three");
  assert.equal(m.live, true);
  assert.equal(m.upcoming, false);
});

test("a finished series on the same page still reads as finished", () => {
  const m = byTeams("vp", "bigodes");
  assert.deepEqual(m.scores, [3, 0]);
  assert.equal(m.finished, true);
  assert.equal(m.live, false);
});

test("only the games actually played carry goals", () => {
  const m = byTeams("vp", "Mate y Tapa");
  const played = m.maps.filter((g) => g.score1 !== null || g.score2 !== null);
  assert.equal(played.length, 3, "three games in, two slots still empty");
  assert.equal(m.maps.length, 5, "a Bo5 template carries five slots throughout");
  // The names are on the unplayed slots too: the map order is set before the
  // series starts, which is what makes a map pool worth showing early.
  assert.equal(m.maps[4].name, "Champions Field");
});

test("a live series holds the fast poll cadence open", () => {
  // Without this, a page with two series being played fell back to the
  // 10-minute event-day cadence, because a live match is not upcoming.
  const plan = pollPlan(midMatches, Date.parse("2026-09-15T18:21:00Z"));
  assert.equal(plan.state, "live");
  assert.equal(plan.everyMs, LIVE);
  assert.equal(perHour(plan), 60);
});

// ---- team codes -----------------------------------------------------------
//
// A bracket writes {{TeamOpponent|flcn}}, and nothing in the wikitext says what
// flcn is: the expansion happens in Liquipedia's own team database. The
// rendered page states it outright, which is what makes resolving it safe to
// do unattended rather than by pairing two lists in document order.
test("a rendered page states its own team codes", () => {
  const html =
    '<div class="brkts-opponent-entry" aria-label="Team Falcons">' +
    '<div class="team-name-dynamic" data-team-shortname="FLCN" data-team-bracketname="Team Falcons" data-team-name="Team Falcons"></div>' +
    '<div class="team-name-dynamic" data-team-shortname="VP" data-team-bracketname="Virtus.pro" data-team-name="Virtus.pro"></div>' +
    '<div class="team-name-dynamic" data-team-shortname="M8" data-team-bracketname="Gentle Mates" data-team-name="Gentle Mates Alpine"></div>' +
    '<div class="team-name-dynamic" data-team-name=""></div></div>';
  const { teams, alias } = teamsFromRender(html);

  assert.deepEqual([...teams].sort(), ["Gentle Mates Alpine", "Team Falcons", "Virtus.pro"]);
  assert.equal(alias.flcn, "Team Falcons");
  assert.equal(alias.vp, "Virtus.pro");
  // A team drawn under a shorter name than its own reaches the map by both,
  // which is the case that makes the bracket and the participant table agree.
  assert.equal(alias["gentle mates"], "Gentle Mates Alpine");
  assert.equal(alias["gentle mates alpine"], "Gentle Mates Alpine");
  assert.equal(Object.keys(alias).length, 7, "an entry with no name is skipped");
});

test("a page with no rendered teams yields nothing rather than an empty map", () => {
  // Writing an empty map over a good one would un-resolve every team on the
  // site, so the caller refuses on an empty result rather than saving it.
  const { teams } = teamsFromRender("<div>no bracket drawn yet</div>");
  assert.equal(teams.size, 0);
});

// ---- a bracket is named by the page, not by its position -------------------

import { headingBefore } from "../scripts/parseBracket.mjs";

test("a bracket takes its name from the heading above it", () => {
  const page = [
    "===Swiss Tiebreaker===",
    "{{MatchSection|Swiss Tiebreaker}}",
    "{{Bracket|Bracket/2-1Q-U-2-2QL|id=aaa",
    "|R1M1={{Match|opponent1={{TeamOpponent|furia|score=1}}",
    "  |opponent2={{TeamOpponent|karmine corp|score=3}}|finished=true}}",
    "}}",
    "",
    "==Playoffs==",
    "{{Bracket|Bracket/8U4L4DSL1D|id=bbb",
    "|R4M1={{Match|opponent1={{TeamOpponent|g2|score=2}}",
    "  |opponent2={{TeamOpponent|bds|score=4}}|finished=true}}",
    "}}",
  ].join("\n");

  // The 2024 Worlds ran no play-in. Its first bracket is the two-series
  // tiebreaker that set the 3rd, 4th and 5th seeds, and calling it a play-in
  // because it came first invented a stage that season never had.
  assert.deepEqual(parseBrackets(page).map((b) => b.title), ["Swiss Tiebreaker", "Playoffs"]);
});

test("a heading written through a template keeps only its label", () => {
  // The 2025 Majors head their sections ==={{Stage|Playoffs}}=== rather than
  // ===Playoffs===, and the raw heading would print the template source.
  const page = "==={{Stage|Playoffs}}===\n{{Bracket|Bracket/4U2L2DSL1D|id=ccc\n}}";
  assert.equal(parseBrackets(page)[0].title, "Playoffs");
});

test("a bracket with no heading above it has no name of its own", () => {
  assert.equal(headingBefore("{{Bracket|x|id=d}}", 0), null);
});

test("the real pages name every bracket they carry", () => {
  const named = parseBrackets(fixture("worlds-midseries.wikitext")).map((b) => b.title);
  assert.deepEqual(named, ["Play-In", "Playoffs"]);
});

// ---- the small companion the board reads -----------------------------------

import { eventNow } from "../scripts/assemble.mjs";

const lanDoc = {
  generatedAt: "2026-09-16T12:00:00.000Z",
  events: [
    { slug: "boston-major-2026", name: "Boston Major", starts: "2026-02-19", ends: "2026-02-22", stages: [] },
    {
      slug: "worlds-2026", name: "RLCS 2026 World Championship",
      starts: "2026-09-15", ends: "2026-09-20", city: "Fort Worth", country: "United States",
      stages: [{
        brackets: [{ matches: [{ teams: ["Team Vitality", "NRG"] }, { teams: ["NRG", null] }] }],
        matchlists: [{ matches: [{ teams: ["Karmine Corp", "Team Vitality"] }] }],
      }],
    },
  ],
};

test("the event being played today is named, with everyone in it", () => {
  const now = eventNow(lanDoc, "2026-09-16");
  assert.equal(now.event.slug, "worlds-2026");
  assert.equal(now.event.city, "Fort Worth");
  // Deduplicated, sorted, and a TBD slot is not a team.
  assert.deepEqual(now.teams, ["Karmine Corp", "NRG", "Team Vitality"]);
});

test("between events it answers null rather than the nearest one", () => {
  // Eleven months of the year. The board draws no banner from this, which is
  // the point: there is no LAN, so there is nothing to say about one.
  const now = eventNow(lanDoc, "2026-07-01");
  assert.equal(now.event, null);
  assert.deepEqual(now.teams, []);
});

test("the window includes both its end days", () => {
  assert.equal(eventNow(lanDoc, "2026-09-15").event.slug, "worlds-2026");
  assert.equal(eventNow(lanDoc, "2026-09-20").event.slug, "worlds-2026");
  assert.equal(eventNow(lanDoc, "2026-09-21").event, null);
});

test("it stays small enough for the board to fetch", () => {
  // bracket.json is over half a megabyte; this exists because that is not a
  // thing to download in order to learn whether a tournament is on.
  assert.ok(JSON.stringify(eventNow(lanDoc, "2026-09-16")).length < 2048);
});

// ---- what still needs resolving -------------------------------------------

import { looksLikeCode } from "../scripts/assemble.mjs";

test("a Liquipedia short code is what needs resolving", () => {
  for (const code of ["kc", "g2s", "flcn", "vp", "virtus.pro", "geng"]) {
    assert.equal(looksLikeCode(code), true, code);
  }
});

test("a name that is already a name is not an unresolved code", () => {
  // The 15 September alarm, repeating every five minutes: the Paris wikitext
  // writes {{TeamOpponent|Manchester City Esports}} in full, so there is no
  // code to resolve and no amount of re-resolving could ever produce one.
  for (const name of ["Manchester City Esports", "Shopify Rebellion", "NRG", "TSM", "Team Falcons"]) {
    assert.equal(looksLikeCode(name), false, name);
  }
});

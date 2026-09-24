// The schedule panel's pure parts.
//
// What is worth testing here is not the markup, it is the RESTRAINT: the panel
// must never invent a kickoff time. Liquipedia publishes per-match times only a
// few days before a stage is played, so for most of an event the honest answer
// is a day range, and the tests below are mostly about which bucket a match
// with missing information lands in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesOf, sectionName, fixturesFrom, whenWords, ordinal, spanWords, zoneLabel, panelHTML, eventRunning } from "../web/fixtures.mjs";
import { PAD } from "../scripts/events.mjs";

const T = (iso) => Date.parse(iso);

// The event the panel is shown for, shaped the way a Worlds page parses: a
// dated play-in bracket, an undated group matchlist, and an undated playoff
// bracket.
const ev = (over = {}) => ({
  slug: "worlds-2026", name: "RLCS 2026 World Championship",
  starts: "2026-09-15", ends: "2026-09-20",
  stages: [{
      schedule: [
        { name: "Play-In", from: "2026-09-15", to: "2026-09-15" },
        { name: "Group Stage", from: "2026-09-16", to: "2026-09-17" },
        { name: "Playoffs", from: "2026-09-18", to: "2026-09-20" },
      ],
      tables: [{ title: "Group A", rows: [] }],
      matchlists: [{ matches: [
        { label: "Round 1", teams: ["Karmine Corp", "MIBR"], scores: [3, 1], finished: true, upcoming: false, live: false, startsAt: null },
        { label: "Round 2", teams: ["Karmine Corp", "Team Falcons"], scores: [null, null], finished: false, upcoming: true, live: false, startsAt: null },
      ] }],
      brackets: [
        { matches: [
          { label: "Play-In Round 1", teams: ["TSM", "Bigodes"], scores: [3, 0], finished: true, startsAt: "2026-09-15T16:00:00.000Z" },
        ] },
        { matches: [
          { label: "Grand Final", teams: [null, null], scores: [null, null], finished: false, upcoming: true, startsAt: null },
        ] },
      ],
    ...over,
  }],
});

test("a match carries the day range of the stage it belongs to", () => {
  const all = matchesOf(ev());
  assert.equal(all.length, 4);
  const group = all.find((m) => m.label === "Round 2");
  // The section is called "Group stage" and the schedule line "Group Stage";
  // matching those by equality alone left every group match undated.
  assert.equal(group.stage, "Group Stage");
  assert.deepEqual(group.window, { from: "2026-09-16", to: "2026-09-17" });
  assert.deepEqual(all.find((m) => m.label === "Grand Final").window, { from: "2026-09-18", to: "2026-09-20" });
});

test("a bracket is named by what it holds, not by its id", () => {
  // The feed keys brackets by a wikitext id, so the stage a bracket belongs to
  // has to be worked out from its matches.
  const final = { matches: [{ label: "Grand Final" }] };
  const play = { matches: [{ label: "Round 1" }] };
  assert.equal(sectionName(final, 1, [play, final]), "Playoffs");
  assert.equal(sectionName(play, 0, [play, final]), "Play-In");
  assert.equal(sectionName(play, 0, [play]), "Playoffs");
  assert.equal(sectionName({ title: "Swiss Tiebreaker", matches: [] }, 0, [{}, {}]), "Swiss Tiebreaker");
});

test("a match that has started and has no result is live", () => {
  const d = ev();
  const m = d.stages[0].brackets[0].matches[0];
  m.finished = false;
  const f = fixturesFrom(d, T("2026-09-15T16:40:00Z"));
  assert.equal(f.live.length, 1);
  assert.equal(f.live[0].label, "Play-In Round 1");
  // Two hours later the page has plainly stopped being updated for it, and a
  // panel that keeps saying "on now" is worse than one that says nothing.
  assert.equal(fixturesFrom(d, T("2026-09-15T19:00:00Z")).live.length, 0);
});

test("a dated match to come is listed with its time", () => {
  const d = ev();
  d.stages[0].brackets[0].matches.push({
    label: "Play-In Round 2", teams: ["TSM", "R8 Esports"], scores: [null, null],
    finished: false, upcoming: true, startsAt: "2026-09-15T18:00:00.000Z",
  });
  const f = fixturesFrom(d, T("2026-09-15T17:30:00Z"));
  assert.deepEqual(f.next.map((m) => m.label), ["Play-In Round 2"]);
  assert.equal(f.later.length, 0);
});

test("an undated match whose stage runs today is listed without one", () => {
  // The group stage matches have both teams and no kickoff. Saying they are on
  // today is true; putting a clock on them would not be.
  const f = fixturesFrom(ev(), T("2026-09-16T10:00:00Z"));
  assert.deepEqual(f.later.map((m) => m.label), ["Round 2"]);
  assert.equal(f.next.length, 0);
  assert.deepEqual(f.soon, [{ stage: "Playoffs", format: null, window: { from: "2026-09-18", to: "2026-09-20" }, today: false }]);
});

test("a stage whose matches are all TBD still says when it runs", () => {
  // On a playoff day every remaining match reads TBD against TBD until the
  // round before it finishes, so the stage line is the only true thing left.
  const f = fixturesFrom(ev(), T("2026-09-18T12:00:00Z"));
  assert.equal(f.later.length, 0);
  assert.deepEqual(f.soon, [{ stage: "Playoffs", format: null, window: { from: "2026-09-18", to: "2026-09-20" }, today: true }]);
});

test("a stage is named once, not once per match", () => {
  const d = ev();
  const b = d.stages[0].brackets[1].matches;
  b.push({ ...b[0], label: "Upper Bracket Final" }, { ...b[0], label: "Lower Bracket Final" });
  assert.equal(fixturesFrom(d, T("2026-09-16T10:00:00Z")).soon.length, 1);
});

test("nothing left to play means no panel", () => {
  const d = ev();
  for (const s of d.stages) {
    for (const g of [...s.matchlists, ...s.brackets]) for (const m of g.matches) { m.finished = true; m.upcoming = false; }
  }
  assert.equal(fixturesFrom(d, T("2026-09-20T23:00:00Z")), null);
  assert.equal(fixturesFrom(null, Date.now()), null);
  assert.equal(panelHTML(null, Date.now()), "");
});

test("a kickoff reads as a clock, with the date when it is not today", () => {
  // A time is what somebody plans an evening around. Another day gets the day
  // of the month, not "tomorrow": at 23:00 "tomorrow 00:00" is an hour away
  // and reads like a different evening.
  const now = T("2026-09-16T12:00:00Z");
  const local = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dayOf = (iso) => new Date(iso).getDate();
  assert.equal(whenWords("2026-09-16T14:10:00Z", now), local("2026-09-16T14:10:00Z"));
  const next = "2026-09-17T14:10:00Z";
  assert.equal(whenWords(next, now), ordinal(dayOf(next)) + " " + local(next));
  assert.equal(whenWords(null, now), null);
  assert.equal(whenWords("nonsense", now), null);
});

test("ordinals are ordinals, including the teens", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 18, 21, 22, 23, 30].map(ordinal),
    ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "18th", "21st", "22nd", "23rd", "30th"]);
});

// The locale is passed in rather than left to the machine running the tests:
// GitHub's runners report en-US, a British laptop en-GB, and a test that only
// passes on one of them says nothing about the code.
const GB = "en-GB";
// formatRange spaces its dash with whatever space the locale data uses (a thin
// or narrow no-break space on some ICU builds), so compare on plain spaces.
const plain = (s) => s.replace(/\s/g, " ");

test("a day range reads as one", () => {
  assert.equal(plain(spanWords({ from: "2026-09-18", to: "2026-09-20" }, GB)), "18 – 20 Sept");
  assert.equal(spanWords({ from: "2026-09-17", to: "2026-09-17" }, GB), "17 Sept");
  assert.equal(spanWords(null, GB), "");
});

test("a day range reads as one in a month-first locale too", () => {
  // Built by hand as "day, dash, formatted end", en-US came out "18–Sep 20".
  assert.equal(plain(spanWords({ from: "2026-09-18", to: "2026-09-20" }, "en-US")), "Sep 18 – 20");
});

test("a range across two months names both", () => {
  // "30–2 Oct" dropped September entirely.
  assert.equal(plain(spanWords({ from: "2026-09-30", to: "2026-10-02" }, GB)), "30 Sept – 2 Oct");
});

test("a date is the same date whatever zone the reader is in", () => {
  // Midday UTC is already the next day at UTC+13, which put the end of a
  // range a day late for a reader in New Zealand.
  const saved = process.env.TZ;
  process.env.TZ = "Pacific/Auckland";
  try {
    assert.equal(plain(spanWords({ from: "2026-09-18", to: "2026-09-20" }, GB)), "18 – 20 Sept");
  } finally { process.env.TZ = saved; }
});

test("the markup escapes what Liquipedia supplies", () => {
  // Team names and round labels come from a wiki anyone can edit, so they are
  // the one untrusted string in this panel.
  const d = ev();
  d.stages[0].matchlists[0].matches[1].teams[0] = '<img src=x onerror=alert(1)>';
  d.stages[0].matchlists[0].matches[1].label = '"><script>bad()</script>';
  const html = panelHTML(d, T("2026-09-16T10:00:00Z"));
  assert.ok(!html.includes("<script>"), html);
  // The text is still in there, as text: no tag of its own opens anywhere.
  assert.ok(!/<img src=x/.test(html), html);
  assert.ok(html.includes("&lt;img"), html);
  assert.ok(html.includes("&lt;script&gt;"), html);
});

test("only the groups with something in them are drawn", () => {
  const html = panelHTML(ev(), T("2026-09-16T10:00:00Z"));
  assert.ok(html.includes("Later today"));
  assert.ok(html.includes("To come"));
  // No empty headings: a group with no lines is not drawn at all.
  assert.ok(!html.includes("<h3>Live</h3>"), html);
  assert.ok(!html.includes("<h3>Next</h3>"), html);
});

test("a narrow screen gets the stage line instead of four undated rows", () => {
  // Beside the bracket those rows cost nothing; above it, each one pushes the
  // bracket further down. The fact kept is the one with a time in
  // it: this stage is on today.
  const wide = panelHTML(ev(), T("2026-09-16T10:00:00Z"));
  const thin = panelHTML(ev(), T("2026-09-16T10:00:00Z"), { compact: true });
  assert.ok(wide.includes("Karmine Corp"));
  assert.ok(!thin.includes("Karmine Corp"), thin);
  assert.ok(thin.includes("Group Stage"), thin);
  assert.ok(thin.includes("today"), thin);
});

test("a live match survives the narrow form", () => {
  const d = ev();
  d.stages[0].brackets[0].matches[0].finished = false;
  const thin = panelHTML(d, T("2026-09-15T16:40:00Z"), { compact: true });
  assert.ok(thin.includes("TSM"), thin);
  assert.ok(thin.includes('class="fxm live"'), thin);
});

// An event that plays two disciplines: the 2026 Worlds runs a 1v1 title on its
// own Liquipedia page alongside the 3v3.
const twoFormats = () => ({
  slug: "worlds-2026", name: "RLCS 2026 World Championship",
  starts: "2026-09-15", ends: "2026-09-20",
  stages: [
    {
      format: "3v3", schedule: [{ name: "Group Stage", from: "2026-09-16", to: "2026-09-17" }],
      tables: [], matchlists: [], brackets: [{ matches: [
        { label: "Round 3", teams: ["NRG", "MIBR"], scores: [null, null], finished: false, upcoming: true, startsAt: "2026-09-16T18:00:00.000Z" },
      ] }],
    },
    {
      format: "1v1", schedule: [], tables: [], matchlists: [], brackets: [{ matches: [
        { label: "Semifinals", teams: ["nass", "diaz"], scores: [null, null], finished: false, upcoming: true, startsAt: "2026-09-16T17:00:00.000Z" },
        { label: "Final", teams: ["Nwpo", null], scores: [null, null], finished: false, upcoming: true, startsAt: null, startsOn: "2026-09-18" },
      ] }],
    },
  ],
});

test("the formats share one list, in the order they are played", () => {
  // The whole point of not separating them: a 1v1 semifinal at 17:00 comes
  // before a 3v3 group match at 18:00, because that is when they happen.
  const f = fixturesFrom(twoFormats(), T("2026-09-16T12:00:00Z"));
  assert.deepEqual(f.next.map((m) => [m.format, m.label]), [["1v1", "Semifinals"], ["3v3", "Round 3"]]);
  assert.deepEqual(f.formats, ["1v1", "3v3"]);
});

test("a row says which format it is only when the event has two", () => {
  const two = panelHTML(twoFormats(), T("2026-09-16T12:00:00Z"));
  assert.ok(two.includes(">1v1<") && two.includes(">3v3<"), two);
  // One discipline: naming it on every row states a fact the reader has.
  assert.ok(!panelHTML(ev(), T("2026-09-16T10:00:00Z")).includes('class="fxf"'));
});

test("a 1v1 row carries no team crest", () => {
  // The name in a 1v1 is a person. A tinted monogram beside it invents an org
  // the row is not about.
  const html = panelHTML(twoFormats(), T("2026-09-16T12:00:00Z"));
  const solo = html.slice(html.indexOf("nass") - 400, html.indexOf("nass"));
  assert.ok(!solo.includes('class="av'), solo);
  assert.ok(html.includes('class="av'), "the 3v3 row still has one");
});

test("a match dated to a day, with no kickoff, keeps the day", () => {
  // Liquipedia gives the 1v1 final "September 18, 2026" and no time. That is
  // not a kickoff, so it is not listed as one, and it is not thrown away.
  const f = fixturesFrom(twoFormats(), T("2026-09-16T12:00:00Z"));
  assert.ok(!f.next.some((m) => m.label === "Final"));
  assert.deepEqual(f.soon, [{ stage: "Final", format: "1v1", window: { from: "2026-09-18", to: "2026-09-18" }, today: false }]);
});

test("two disciplines with the same round name stay two lines", () => {
  // Both titles end in a final, and collapsing them onto one line would say
  // the 1v1 final and the 3v3 final were the same match.
  const d = twoFormats();
  d.stages[0].schedule.push({ name: "Playoffs", from: "2026-09-18", to: "2026-09-20" });
  d.stages[0].brackets.push({ matches: [
    { label: "Grand Final", teams: [null, null], scores: [null, null], finished: false, upcoming: true, startsAt: null },
  ] });
  const f = fixturesFrom(d, T("2026-09-16T12:00:00Z"));
  // Both run from the 18th, so the order between them is the order they were
  // parsed; what matters is that there are two lines and each names its own.
  assert.deepEqual(f.soon.map((x) => [x.format, x.stage]).sort(),
    [["1v1", "Final"], ["3v3", "Playoffs"]]);
});

test("a round with one named match shows the match, not the round", () => {
  // The 1v1 final is Nwpo against nass on the 18th. A line reading "Final,
  // 18 Sept" threw away the half of that a reader came for.
  const d = twoFormats();
  d.stages[1].brackets[0].matches[1].teams = ["Nwpo", "nass"];
  const f = fixturesFrom(d, T("2026-09-16T12:00:00Z"));
  const final = f.soon.find((s) => s.stage === "Final");
  assert.deepEqual(final.match.teams, ["Nwpo", "nass"]);
  const html = panelHTML(d, T("2026-09-16T12:00:00Z"), { locale: GB });
  assert.ok(html.includes("Nwpo") && html.includes("nass"), html);
  // Still says when, because that is the only timing the page has published.
  assert.ok(html.includes("18 Sept"), html);
});

test("a round still deciding who is in it stays a round", () => {
  // Two TBD slots name nobody, so the honest line is the round and its days.
  const f = fixturesFrom(twoFormats(), T("2026-09-16T12:00:00Z"));
  assert.equal(f.soon.find((s) => s.stage === "Final").match, undefined);
});

test("today means the reader's today, not UTC's", () => {
  // The word is about the reader's day. At 21:00 in New York it is already
  // tomorrow in UTC, and bucketing on the UTC date moved that evening's
  // matches into "to come" while they were still hours away.
  const d = ev();
  // Whatever zone this runs in, "today" is the local date of nowMs.
  const now = T("2026-09-16T23:30:00Z");
  const local = new Date(now);
  const pad = (n) => String(n).padStart(2, "0");
  const localDate = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`;
  d.stages[0].schedule = [{ name: "Group Stage", from: localDate, to: localDate }];
  const f = fixturesFrom(d, now);
  assert.ok(f.later.some((m) => m.label === "Round 2"),
    "a stage running on the reader's today is on today");
});

test("the panel names the reader's timezone", () => {
  // The times are converted silently, and "17:00" alone cannot be checked
  // against a stream overlay in venue time. Whatever zone this runs in, the
  // label is the one the browser reports for it.
  const now = T("2026-09-16T10:00:00Z");
  const expected = new Intl.DateTimeFormat([], { timeZoneName: "short" })
    .formatToParts(new Date(now)).find((p) => p.type === "timeZoneName").value;
  const label = zoneLabel(now);
  assert.ok(label.length, "a zone is named");
  // Either the locale's own name, or the en-US abbreviation when the locale
  // would only offer an offset.
  assert.ok(label === expected || !/^GMT|^UTC/.test(label), label);
  assert.ok(panelHTML(ev(), now).includes(label), "and it reaches the panel");
});

test("an event is running inside its dates padded a day either side", () => {
  const e = { starts: "2026-09-15", ends: "2026-09-20", stages: [] };
  assert.equal(eventRunning(e, T("2026-09-21T00:30:00Z")), true, "a venue evening past midnight UTC");
  assert.equal(eventRunning(e, T("2026-09-14T06:00:00Z")), true);
  assert.equal(eventRunning(e, T("2026-09-22T06:00:00Z")), false);
});

test("a live match keeps an event running past its window, a stale one does not", () => {
  const e = (m) => ({ starts: "2026-09-15", ends: "2026-09-20", stages: [{ brackets: [{ matches: [m] }], matchlists: [] }] });
  const at = T("2026-09-23T00:30:00Z");
  assert.equal(eventRunning(e({ live: true, finished: false, startsAt: "2026-09-22T23:30:00Z" }), at), true);
  // A score left on a page nobody finished is not a tournament running forever.
  assert.equal(eventRunning(e({ live: true, finished: false, startsAt: "2026-09-18T23:30:00Z" }), at), false);
});

test("the page and the collector pad an event by the same amount", () => {
  const e = { starts: "2026-09-15", ends: "2026-09-15", stages: [] };
  assert.equal(eventRunning(e, T("2026-09-15T00:00:00Z") - PAD), true);
  assert.equal(eventRunning(e, T("2026-09-15T00:00:00Z") - PAD - 1), false);
});

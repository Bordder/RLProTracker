// The schedule panel: what is on in this event, and what is next.
//
// It sits beside a bracket rather than inside it. A bracket is a shape - who
// plays whom, and who came through - and reading a kickoff time off it means
// hunting for the one box with a clock under it. This is the same event read
// the other way round, by time, which is the question somebody watching asks.
//
// It follows the event being VIEWED, not the one being played, so browsing the
// 2024 Worlds shows that event's schedule rather than this week's.
//
// Everything it can say comes out of the bracket feed, and the feed only knows
// what Liquipedia has published. That matters more here than anywhere else on
// the site: Liquipedia dates a stage's matches a few days before that stage is
// played, so for most of an event the later rounds have teams and no kickoff
// time, or a time and no teams. The panel is built around that rather than
// pretending otherwise. A match with a time gets a time, a dated stage with no
// times gets its day range, and nothing here ever guesses a clock.
// Relative, not "/crest.mjs": this module sits at the site root beside it, so
// both resolve the same in the browser, and the relative form also loads under
// node, where the tests import this file directly.
import { crest, assignHues, hasLogo } from "./crest.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// A started match with nobody's score entered yet is still on. Same window the
// bracket page uses, and the same reason: a Bo7 plus overtime fits inside it,
// and past it a page that has stopped being updated should stop claiming a
// match is live.
export const LIVE_FOR = 2 * 3600e3;

// How many of each kind of line the panel carries. It is a column beside a
// bracket, so it can be longer than a banner, but a list past the fold has
// stopped being a glance.
// The column scrolls inside itself, so "next" can be a real list rather than a
// teaser. Sized against a real Worlds day: twelve 3v3 group kickoffs published
// at once, then the 2v2 semifinals in the evening. At twelve the list was
// exactly the 3v3 and the second discipline fell off the end, which is the one
// thing this panel exists not to do.
const MAX_NEXT = 16, MAX_LATER = 8, MAX_LIVE = 4;

// The reader's own date, not the UTC one.
//
// This is what decides whether a stage is "today", and the word is about the
// reader's day: at 21:00 in New York it is already tomorrow in UTC, and the
// column would have moved the evening's matches into "to come" while they were
// still hours away. Liquipedia's stage dates are the venue's, so for somebody
// far from the venue the two can still disagree by a few hours near midnight -
// per-match times are unaffected, because those are real instants.
const day = (ms) => {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const isLive = (m, nowMs) => Boolean(m?.live) ||
  Boolean(m?.startsAt && !m.finished &&
    nowMs >= Date.parse(m.startsAt) && nowMs - Date.parse(m.startsAt) < LIVE_FOR);

const windowOf = (st) => (st?.from ? { from: st.from, to: st.to || st.from } : null);

// Which section a bracket is, the same way the bracket page names it: from the
// heading it sat under, then from what it contains, then from its position. The
// feed keys brackets by id, so a match label like "Lower Bracket Round 1" says
// nothing about which stage line it belongs to and this has to.
export function sectionName(b, i, all) {
  if (b.title) return b.title;
  const labels = (b.matches ?? []).map((m) => (m.label ?? "").toLowerCase());
  if (labels.some((l) => l.includes("grand final") || l === "final")) return "Playoffs";
  if (all.length > 1 && i === 0) return "Play-In";
  return all.length > 1 ? "Stage " + (i + 1) : "Playoffs";
}

/** Every match of an event, each carrying the schedule line for its stage. */
export function matchesOf(ev) {
  const out = [];
  for (const s of ev?.stages ?? []) {
    const sched = s.schedule ?? [];
    // Stage windows come from the page's Format section, which is prose, so a
    // section called "Group stage" has to be matched to a line called "Group
    // Stage" by name overlap rather than by equality.
    const pick = (name) => {
      const n = String(name ?? "").toLowerCase();
      if (!n) return sched.length === 1 ? sched[0] : null;
      return sched.find((x) => x.name.toLowerCase() === n)
        ?? sched.find((x) => n.includes(x.name.toLowerCase()) || x.name.toLowerCase().includes(n))
        ?? (sched.length === 1 ? sched[0] : null);
    };
    const groups = [];
    const lists = s.matchlists ?? [];
    if (lists.length) {
      const name = (s.tables ?? []).length ? "Group stage" : "Swiss stage";
      for (const l of lists) groups.push({ name, matches: l.matches ?? [] });
    }
    (s.brackets ?? []).forEach((b, i) => {
      groups.push({ name: sectionName(b, i, s.brackets), matches: b.matches ?? [] });
    });
    for (const g of groups) {
      const st = pick(g.name);
      // Liquipedia heads a PAIR of group matches with one round name and
      // leaves the second blank, so the second row was falling back to the
      // section name and the panel read "Round 2" then "Group Stage" for two
      // matches of the same round. The heading carries to the rows under it.
      let round = null;
      // The format travels with the match, because the panel deliberately does
      // NOT separate the disciplines: a 1v1 semifinal at 17:00 and a 3v3 group
      // match at 18:00 are one list in the order they are played, which is how
      // somebody watching experiences them.
      for (const m of g.matches) {
        // A match can carry a DAY where the page has not published a kickoff
        // ("September 18, 2026"). That is the fallback, not the override: the
        // stage's own range is what a line about the stage should say, and one
        // dated match inside the playoffs does not shorten them to that day.
        const win = windowOf(st) ?? (m.startsOn ? { from: m.startsOn, to: m.startsOn } : null);
        // A page with no Format section has no stage lines to match, and then
        // the match's own round name says more than the section heading does:
        // the 1v1 page calls its only section "Results".
        round = m.label ?? round;
        out.push({
          ...m,
          label: m.label ?? round,
          stage: st?.name ?? m.label ?? round ?? g.name,
          window: win,
          format: s.format ?? null,
        });
      }
    }
  }
  return out;
}

const timed = (m) => Number.isFinite(Date.parse(m.startsAt ?? ""));
const named = (m) => Boolean(m.teams?.[0] && m.teams?.[1]);

/**
 * The panel's contents. Four buckets, in the order a reader wants them:
 *
 *   live   a match being played
 *   next   dated matches still to come
 *   later  undated matches whose stage runs today, so they are on later today
 *          even though Liquipedia has not said when
 *   soon   one line per undated stage still to be played, with its day range
 */
export function fixturesFrom(ev, nowMs) {
  if (!ev) return null;
  const all = matchesOf(ev);
  const today = day(nowMs);

  const live = all.filter((m) => isLive(m, nowMs))
    .sort((a, b) => (Date.parse(a.startsAt ?? "") || 0) - (Date.parse(b.startsAt ?? "") || 0))
    .slice(0, MAX_LIVE);
  const liveSet = new Set(live);

  const next = all
    .filter((m) => !m.finished && !liveSet.has(m) && timed(m) && Date.parse(m.startsAt) > nowMs)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, MAX_NEXT);

  const undated = all.filter((m) => !m.finished && !liveSet.has(m) && !timed(m));
  const later = undated
    .filter((m) => named(m) && m.window && m.window.from <= today && today <= m.window.to)
    .slice(0, MAX_LATER);

  // One line per stage still to be played. Named teams are not required:
  // "Playoffs, 18-20 Sept" is worth saying while the bracket is still deciding
  // who plays in them, and on a playoff day that line is the only thing the
  // feed can honestly say, because every match in it reads TBD against TBD
  // until the round before it finishes.
  // Keyed by format as well as name: an event running two disciplines has a
  // "Playoffs" in each, and collapsing them into one line would say the 1v1
  // final and the 3v3 final were the same thing.
  const key = (m) => (m.format ?? "") + "\u0000" + m.stage;
  const namedStages = new Set(later.map(key));
  const soon = [];
  for (const m of undated) {
    if (!m.window || m.window.to < today) continue;
    if (namedStages.has(key(m)) || soon.some((s) => key(s) === key(m))) continue;
    // One match in the whole round, with both names known, is worth naming:
    // the 1v1 final is Nwpo against nass on the 18th, and a line reading
    // "Final, 18 Sept" threw away the half of that a reader came for.
    const same = undated.filter((x) => key(x) === key(m));
    const only = same.length === 1 && named(same[0]) ? same[0] : null;
    soon.push({
      stage: m.stage, format: m.format ?? null, window: m.window,
      today: m.window.from <= today && today <= m.window.to,
      ...(only ? { match: only } : null),
    });
  }
  soon.sort((a, b) => a.window.from.localeCompare(b.window.from));

  if (!live.length && !next.length && !later.length && !soon.length) return null;
  // Whether this event plays more than one discipline. With only one, naming it
  // on every row states a fact the reader already has.
  const formats = new Set(all.map((m) => m.format).filter(Boolean));
  return { live, next, later, soon, formats: [...formats].sort() };
}

// ---- words -----------------------------------------------------------------

/**
 * The kickoff: "17:00" today, "18th 00:00" on any other day.
 *
 * The clock leads because that is what somebody plans an evening around. The
 * date is the day of the month rather than "tomorrow" or a weekday: at 23:00
 * "tomorrow 00:00" is an hour away and reads like a different evening, and a
 * weekday still has to be counted back to a date.
 *
 * Local to the reader. Liquipedia publishes these in the venue's zone and the
 * feed stores the instant, so this is the one place the reader's own clock is
 * applied.
 */
export function whenWords(iso, nowMs) {
  const at = Date.parse(iso ?? "");
  if (!Number.isFinite(at)) return null;
  const when = new Date(at);
  const clock = when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  // Local days, not UTC ones: "today" has to mean the reader's today.
  const d0 = new Date(nowMs); d0.setHours(0, 0, 0, 0);
  const sameDay = new Date(at).setHours(0, 0, 0, 0) === d0.getTime();
  return sameDay ? clock : ordinal(when.getDate()) + " " + clock;
}

/** 1st, 2nd, 3rd, 4th ... and the teens, which are all "th". */
export function ordinal(n) {
  const rest = n % 100;
  const suffix = rest >= 11 && rest <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return n + suffix;
}

/**
 * The reader's own timezone, as the short name their locale uses: BST, EDT,
 * AEST, or a "GMT+5:30" where there is no abbreviation.
 *
 * Named rather than described, because the times in this column are converted
 * silently and "17:00" alone cannot be checked against a stream overlay in
 * venue time. Read from the browser at render; nothing is stored and nothing
 * is sent anywhere.
 */
export function zoneLabel(nowMs = Date.now()) {
  const short = (locale) => {
    const parts = new Intl.DateTimeFormat(locale, { timeZoneName: "short" }).formatToParts(new Date(nowMs));
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  };
  try {
    const own = short([]);
    // Most locales name a zone they have a name for and fall back to an offset
    // otherwise. A reader in New York on a British locale gets "GMT-4", where
    // en-US would say "EDT" - the abbreviation the broadcast itself uses. Ask
    // for that one too, and take it when it is a name rather than an offset.
    if (/^(GMT|UTC)/i.test(own)) {
      const us = short("en-US");
      if (us && !/^(GMT|UTC)/i.test(us)) return us;
    }
    return own;
  } catch {
    // A browser with no Intl support says nothing rather than guessing.
    return "";
  }
}

/** "18-20 Sept", or "17 Sept" for a single day. */
export function spanWords(w) {
  if (!w?.from) return "";
  const d = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString([], { day: "numeric", month: "short" });
  return w.to && w.to !== w.from
    ? new Date(w.from + "T12:00:00Z").getUTCDate() + "–" + d(w.to)
    : d(w.from);
}

// ---- drawing ---------------------------------------------------------------

// A crest is a TEAM mark. In a 1v1 the name is a person and in a 2v2 it is
// often a duo name two players made up, and a tinted monogram beside either
// invents an org. An org that really is entered, like Team Falcons in the 2v2,
// keeps its crest: the test is whether there is a logo for the name.
const teamLine = (name, score, won, withCrest) =>
  '<span class="fxt' + (won ? " won" : "") + (name ? "" : " tbd") + '">' + (withCrest ? crest(name) : "") +
  '<span class="fxn">' + esc(name ?? "TBD") + "</span>" +
  (score === null || score === undefined ? "" : "<b>" + esc(score) + "</b>") + "</span>";

function matchEl(m, meta, cls, showFormat) {
  const [a, b] = m.teams ?? [null, null];
  const [sa, sb] = m.scores ?? [null, null];
  const scored = cls === "live";
  const teamGame = !m.format || m.format === "3v3";
  return '<li class="fxm' + (cls ? " " + cls : "") + '">' +
    '<div class="fxh">' + (cls === "live" ? '<i class="fxpip" aria-hidden="true"></i>' : "") +
    (showFormat && m.format ? '<span class="fxf">' + esc(m.format) + "</span>" : "") +
    '<span class="fxl">' + esc(m.label ?? m.stage ?? "") + "</span>" +
    '<span class="fxw">' + esc(meta ?? "") + "</span></div>" +
    teamLine(a, scored ? (sa ?? 0) : null, scored && (sa ?? 0) > (sb ?? 0), teamGame || hasLogo(a)) +
    teamLine(b, scored ? (sb ?? 0) : null, scored && (sb ?? 0) > (sa ?? 0), teamGame || hasLogo(b)) +
    "</li>";
}

const group = (title, body) => body ? '<div class="fxg"><h3>' + esc(title) + "</h3><ul>" + body + "</ul></div>" : "";

/**
 * The panel's markup, or "" when there is nothing true to put in it.
 *
 * `compact` is for a phone, where the panel sits above the bracket instead of
 * beside it and every row it draws pushes the bracket further down. It keeps
 * what is on and what is next, and folds the undated matches of a stage back
 * into the one line they all share, rather than quietly hiding rows with CSS.
 */
export function panelHTML(ev, nowMs, { compact = false } = {}) {
  const f = fixturesFrom(ev, nowMs);
  if (!f) return "";
  if (compact && f.later.length) {
    const stages = [];
    for (const m of f.later) {
      if (!stages.some((s) => s.stage === m.stage)) stages.push({ stage: m.stage, window: m.window, today: true });
    }
    f.soon = [...stages, ...f.soon];
    f.later = [];
  }
  assignHues([...f.live, ...f.next, ...f.later, ...f.soon.map((x) => x.match).filter(Boolean)]
    .flatMap((m) => (!m.format || m.format === "3v3" ? m.teams ?? [] : (m.teams ?? []).filter(hasLogo)))
    .filter(Boolean));

  const multi = f.formats.length > 1;
  const zone = zoneLabel(nowMs);
  const liveBody = f.live.map((m) => matchEl(m, whenWords(m.startsAt, nowMs) ?? "on now", "live", multi)).join("");
  const nextBody = f.next.map((m) => matchEl(m, whenWords(m.startsAt, nowMs), "", multi)).join("");
  // An undated match says so. Liquipedia publishes a stage's kickoffs a few
  // days before it is played, so this is the normal state of a round that has
  // not been scheduled yet rather than a gap in the data.
  const laterBody = f.later.map((m) => matchEl(m, whenWords(m.startsAt, nowMs) ?? "TBD", "soft", multi)).join("");
  const stageWords = (s) => (s.today ? "today, " + spanWords(s.window) : spanWords(s.window));
  // A round with one named match shows the match; otherwise the round's name
  // and the days it runs, which is all the page has published about it.
  const stageLine = (s) => (s.match ? matchEl(s.match, stageWords(s), "soft", multi) : '<li class="fxs">' +
    (multi && s.format ? '<span class="fxf">' + esc(s.format) + "</span>" : "") +
    '<span class="fxl">' + esc(s.stage ?? "Later rounds") + "</span>" +
    '<span class="fxw">' + esc(stageWords(s)) + "</span></li>");
  const todayBody = f.soon.filter((s) => s.today).map(stageLine).join("");
  const soonBody = f.soon.filter((s) => !s.today).map(stageLine).join("");

  return '<div class="fxbox' + (f.live.length ? " onair" : "") + '">' +
    '<div class="fxtop"><span class="fxev">Schedule</span>' +
    // Every time in here is converted to the reader's own clock by their
    // browser, which is invisible unless it is said: a reader in New York sees
    // 12:00 where a reader in London sees 17:00, and both are the same match.
    // Naming the zone is what makes that checkable against a stream overlay.
    (f.live.length ? '<span class="fxon"><i class="fxpip" aria-hidden="true"></i>On now</span>' : "") +
    (zone ? '<span class="fxtz">' + esc(zone) + "</span>" : "") + "</div>" +
    group("Live", liveBody) +
    group("Next", nextBody) +
    group("Later today", laterBody + todayBody) +
    group("To come", soonBody) +
    "</div>";
}

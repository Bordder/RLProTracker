import { crest, assignHues, hasLogo, teamName } from "/crest.mjs?v=3d51b913";
import { standings, pairGroups } from "/standings.mjs?v=5df49caf";
import { panelHTML, ordinal, spanWords, eventRunning } from "/fixtures.mjs?v=3bc2d3dd";
import { headerHTML, scheduleHTML, prizesHTML, teamsHTML, finalOf } from "/eventview.mjs?v=e71fd52c";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// "23:00" today, "17th 23:00" on another day. Same wording as the schedule
// column, so a time means the same thing wherever it is read on this page.
const timeOf = (iso) => {
  if (!iso) return "TBD";
  const at = new Date(iso);
  const clock = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const sameDay = new Date(at).setHours(0, 0, 0, 0) === midnight.getTime();
  return sameDay ? clock : `${ordinal(at.getDate())} ${clock}`;
};
const dayOf = (iso) => iso ? new Date(iso).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" }) : null;
// UTC: a calendar date, not an instant, so it must not shift with the reader.
const shortDay = (d) => d ? new Date(`${d}T12:00:00Z`).toLocaleDateString([], { day: "numeric", month: "short", timeZone: "UTC" }) : "";
const clockOf = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

const BOX_W = 200, GUTTER = 44, ROW_H = 26, BOX_H = ROW_H * 2 + 2;
const SLOT = BOX_H + 30, HEAD_H = 26, TOP = HEAD_H + 10, COL = BOX_W + GUTTER;
// Between the upper band and the lower one. It has to clear the kickoff
// caption that hangs under the last box as well as the box itself, or the
// lower band's round heading lands on top of it - which it did at exactly
// 34, with the caption at y346 and the heading at y342.
const BAND_GAP = 44;
const CAP_H = 18;         // the caption under a box

// The desktop diagram's geometry, and the shape every other one is described
// in. The layout is the same arithmetic at any size, so the phone gets a real
// bracket - feeders, wires, qualified slots - rather than a second layout
// engine that has to be kept in step with this one.
const DESK = { BOX_W, GUTTER, BOX_H, SLOT, HEAD_H, TOP, COL, BAND_GAP, CAP_H };

// The phone's geometry: exactly two round columns per screen, whatever the
// screen is. Measured rather than guessed, because "two columns" is the
// requirement and a fixed width only satisfies it at one device size.
function phoneGeo() {
  const vw = Math.max(280, (document.documentElement.clientWidth || 360) - 40);
  const GUT = 24;
  const W = Math.max(132, Math.floor((vw - GUT) / 2));
  const H = 92;           // the date line, then two team rows
  return { BOX_W: W, GUTTER: GUT, BOX_H: H, SLOT: H + 14, HEAD_H: 24,
           TOP: 30, COL: W + GUT, BAND_GAP: 34, CAP_H: 0, pack: true };
}
const LIVE_FOR = 2 * 3600e3;   // a started match counts as live for this long

// The R<n>M<n> key, which is how the edge list names a match.
const slotOf = (m) => `R${m.round}M${m.position}`;

// Live means the wikitext is carrying a score for a series it has not called
// finished. The clock is the fallback for a match nobody has scored yet: a
// start time that has passed and is recent enough to still be on.
const isLive = (m) => Boolean(m.live) ||
  Boolean(m.startsAt && !m.finished &&
    Date.now() >= Date.parse(m.startsAt) && Date.now() - Date.parse(m.startsAt) < LIVE_FOR);

// Every match of the event being shown, flat and indexed, so a box can carry
// a number rather than its whole contents in data attributes.
let MATCHES = [];
let CURRENT = null;      // slug of the event on screen
let SCHED = [];          // the stage schedule, from the page's Format section
// Which stage a match belongs to, set while a section is being rendered, so
// an undated match can still say when its stage runs.
let STAGE = null;
// And which discipline, for the same reason the schedule column tracks it: the
// name in a 1v1 box is a person and in a 2v2 box often a duo name two players
// made up, and a tinted monogram beside either invents an org. An org that
// really is entered keeps its crest - Team Falcons in the 2v2 is Team Falcons -
// so outside the team event the test is whether a logo exists for the name.
let FORMAT = null;
const teamMark = (name) => (!FORMAT || FORMAT === "3v3" || hasLogo(name) ? crest(name) : "");

// "18-20 Sept", or "15 Sept" for a single day. The schedule column's own
// wording, so the two never disagree about how a range reads.
function windowOf(st) {
  if (!st?.from) return null;
  return spanWords({ from: st.from, to: st.to });
}

// Match a section to its line in the Format section. The names line up
// ("Play-In", "Group Stage", "Playoffs"); a contains-either test covers
// "Swiss Stage" against a section called "Swiss stage".
//
// The last pass is on the first word alone, for the 2025 Worlds, where the
// three group brackets are headed "Group A", "Group B" and "Group C" and the
// format lists one line for the whole "Group Stage". Without it those three
// sections have no window, and a section with no window sorts to the end of
// the page, below the playoffs they feed.
const firstWord = (s) => s.split(/[\s-]+/)[0];
function stageFor(name) {
  const n = String(name).toLowerCase();
  return SCHED.find((x) => x.name.toLowerCase() === n)
    ?? SCHED.find((x) => n.includes(x.name.toLowerCase()) || x.name.toLowerCase().includes(n))
    ?? SCHED.find((x) => firstWord(x.name.toLowerCase()) === firstWord(n))
    ?? null;
}
const matchesOf = (ev) => ev.stages.flatMap((s) =>
  [...s.brackets.flatMap((b) => b.matches), ...s.matchlists.flatMap((l) => l.matches)]);

// Columns come from the round labels in the wikitext, and the lane from
// whether that label says upper or lower. See parseBracket.mjs.
function columns(matches) {
  const seen = new Map();
  for (const m of matches) {
    const key = m.label ?? `Round ${m.round}`;
    if (!seen.has(key)) seen.set(key, { label: key, section: m.section ?? "final", round: m.round, matches: [] });
    seen.get(key).matches.push(m);
  }
  for (const c of seen.values()) c.matches.sort((a, b) => a.position - b.position);
  return [...seen.values()].sort((a, b) => a.round - b.round);
}

// Where every match in a bracket sits, and which wires to draw.
//
// ONE diagram per bracket, not one per section. The upper bracket, the lower
// bracket and the finals used to be three stacked blocks, each with its own
// horizontal scroller, which put the Paris grand final on a line of its own
// underneath - a column that belongs to the right of everything it follows.
//
// Rounds are numbered consistently across sections in the source (the Paris
// bracket runs lower R1-R4, upper R3, final R5), so the round number IS the
// column. Sections become horizontal bands: upper on top, lower beneath,
// finals placed against whatever feeds them, which is usually one of each.
//
// The feeders come from the bracket template's own edge list (shape.mjs),
// fetched once from Liquipedia's commons wiki. An earlier version inferred
// them and could only do it when a round was exactly half the one before:
// true of a single-elimination tree, false of every double-elimination
// bracket RLCS runs.
function layoutBracket(matches, edges, G = DESK) {
  const rounds = matches.map((m) => m.round);
  const minRound = Math.min(...rounds);
  const sectionOf = (m) => m.section ?? "final";

  // Two ways to turn a round into a column.
  //
  // The diagram uses the round number, so the upper bracket's semifinal and
  // the lower bracket's sit in the same column and the whole page reads as
  // one timeline. That only works when every column is on screen at once.
  //
  // On a phone two columns are, and the 2026 playoffs upper bracket starts at
  // round 3: keeping the round number left the top of the bracket as 600px of
  // empty page, with the band that belongs in it sitting off the right edge.
  // So there each band's columns start at its own first round instead, which
  // is the shape the Liquipedia app draws - the UB pair, then the LB pair
  // under it.
  const packed = new Map();
  if (G.pack) {
    for (const m of matches) {
      const k = sectionOf(m);
      if (!packed.has(k)) packed.set(k, new Set());
      packed.get(k).add(m.round);
    }
    for (const [k, set] of packed) packed.set(k, [...set].sort((a, b) => a - b));
  }
  const colOf = (m) => G.pack
    ? packed.get(sectionOf(m)).indexOf(m.round)
    : m.round - minRound;

  // Columns, keyed by round and section: two sections can share a round and
  // must not share a column heading.
  const cols = new Map();
  for (const m of matches) {
    const key = `${m.round}|${m.section}`;
    if (!cols.has(key)) cols.set(key, { round: m.round, section: m.section, label: m.label ?? `Round ${m.round}`, col: colOf(m), matches: [] });
    cols.get(key).matches.push(m);
  }
  for (const c of cols.values()) c.matches.sort((a, b) => a.position - b.position);

  const y = new Map();      // slot key -> top
  const order = [...cols.values()].sort((a, b) => a.round - b.round);
  const bandOf = new Map(matches.map((m) => [slotOf(m), sectionOf(m)]));

  // Where a match's feeders sit, so it can be placed against them. In a
  // packed layout only feeders from the same band count: the other band's
  // rows are somewhere else entirely on the page, and centring on them would
  // drop this match on top of whatever is already there.
  const feeders = (m) => {
    const e = edges?.[slotOf(m)];
    if (!e) return [];
    return [e.upper, e.lower].filter(Boolean)
      .filter((k) => y.has(k) && (!G.pack || bandOf.get(k) === sectionOf(m)))
      .map((k) => y.get(k));
  };

  // Each band is laid out in round order, so a match's feeders are always
  // already placed by the time it is reached.
  const placeBand = (section, top) => {
    let first = true, bottom = top;
    for (const c of order.filter((x) => x.section === section)) {
      const want = c.matches.map((m) => {
        const f = feeders(m);
        return f.length ? f.reduce((a, b) => a + b, 0) / f.length : null;
      });
      // A column with no feeders in view - the first of a band, or a bracket
      // with no shape at all - is stacked evenly rather than dropped.
      const step = first ? G.SLOT : Math.max(G.SLOT, (bottom - top) / Math.max(1, c.matches.length));
      want.forEach((v, i) => { if (v === null) want[i] = top + i * step; });

      // Keep a column in order and never overlapping, without moving a match
      // off its feeders unless it has to.
      const idx = want.map((_, i) => i).sort((a, b) => want[a] - want[b]);
      let floor = -Infinity;
      for (const i of idx) {
        want[i] = Math.max(want[i], floor);
        floor = want[i] + G.BOX_H + 14;
      }
      c.matches.forEach((m, i) => y.set(slotOf(m), want[i]));
      bottom = Math.max(bottom, ...want.map((v) => v + G.BOX_H + G.CAP_H));
      first = false;
    }
    return bottom;
  };

  const upperBottom = placeBand("upper", G.TOP);
  const lowerBottom = placeBand("lower", (order.some((c) => c.section === "upper") ? upperBottom + G.BAND_GAP : G.TOP));
  const full = Math.max(upperBottom, lowerBottom);

  // Packed columns put the finals in their own band under the other two: at
  // column zero of their own sequence, the centring below would drop them on
  // top of whatever the bands already have there.
  const finalsBanded = G.pack && order.some((c) => c.section === "final") &&
    order.some((c) => c.section !== "final");
  if (finalsBanded) placeBand("final", full + G.BAND_GAP);

  // Finals sit against their feeders, which normally means between the two
  // bands. With no edge list, centre them instead of stacking them at the top.
  for (const c of finalsBanded ? [] : order.filter((x) => x.section === "final")) {
    const want = c.matches.map((m) => {
      const f = feeders(m);
      return f.length ? f.reduce((a, b) => a + b, 0) / f.length : null;
    });
    const span = full - G.TOP;
    want.forEach((v, i) => {
      if (v !== null) return;
      const n = c.matches.length;
      want[i] = G.TOP + span / 2 - G.BOX_H / 2 + (i - (n - 1) / 2) * G.SLOT;
    });
    const idx = want.map((_, i) => i).sort((a, b) => want[a] - want[b]);
    let floor = -Infinity;
    for (const i of idx) { want[i] = Math.max(want[i], floor); floor = want[i] + G.BOX_H + 14; }
    c.matches.forEach((m, i) => y.set(slotOf(m), want[i]));
  }

  // Wires. Every edge is drawn now, including the ones that cross bands: a
  // loser dropping out of the upper bracket into the lower one is the whole
  // point of a double-elimination diagram, and while the bands were separate
  // scrollers that line had nowhere to land.
  const links = [];
  for (const m of matches) {
    const e = edges?.[slotOf(m)];
    if (!e) continue;
    // Packed columns are per band, so the gutter to the left of a column
    // belongs to that band alone: a wire from another one would be drawn at
    // an x that means nothing. The loser dropping out of the upper bracket is
    // the one relationship the phone cannot show, and a line into the wrong
    // place says less than no line.
    const keep = (k) => y.has(k) && (!G.pack || bandOf.get(k) === sectionOf(m));
    const from = [e.upper, e.lower].filter(Boolean).filter(keep).map((k) => y.get(k));
    if (from.length) links.push({ col: colOf(m), from, to: y.get(slotOf(m)) });
  }

  // Matches whose winner qualifies out of this bracket get a slot to the
  // right saying so, which is what a play-in is for and what Liquipedia
  // draws there.
  const quals = G.quals === false ? [] : matches
    .filter((m) => edges?.[slotOf(m)]?.qualifies)
    .map((m) => ({ m, col: colOf(m) + 1, y: y.get(slotOf(m)) }));

  // Nothing may sit above the top of the box.
  //
  // The centring pass places a final against its feeders, and in a small
  // bracket - the 2026 1v1 and 2v2 are two semifinals into one final - that
  // arithmetic comes out NEGATIVE: the first match landed at -33px and its
  // round label at -67px, drawn over the section heading above. Shifting the
  // whole layout down by the overshoot keeps every relationship intact and
  // puts the top row back where the container starts.
  const top = Math.min(...[...y.values()]);
  if (top < G.TOP) {
    const shift = G.TOP - top;
    for (const [k, v] of y) y.set(k, v + shift);
    for (const l of links) { l.to += shift; l.from = l.from.map((v) => v + shift); }
    for (const q of quals) q.y += shift;
  }

  const height = Math.max(...[...y.values()].map((v) => v + G.BOX_H + G.CAP_H)) + 12;
  const lastCol = Math.max(...[...cols.values()].map((c) => c.col), ...quals.map((q) => q.col));
  const width = lastCol * G.COL + G.BOX_W;
  return { cols: [...cols.values()], y, links, quals, height, width };
}

function side(team, score, state) {
  const attr = team ? ` data-team="${esc(team.toLowerCase())}" tabindex="0"` : "";
  return `<div class="side ${state}"${attr}>` +
    `<span class="team${team ? "" : " tbd"}">${teamMark(team)}${esc(teamName(team) ?? "TBD")}</span>` +
    `<span class="sc">${score === null ? "&middot;" : score}</span></div>`;
}

function matchBox(m, x, y) {
  // A series is only won when Liquipedia says it is finished. A Bo5 at 2-1 has
  // a score and no winner, so it shows the score with neither side marked.
  const done = m.finished;
  const [a, b] = m.scores;
  const st = (s, o) => !done || s === null || o === null ? "" : s > o ? "won" : "lost";
  const live = isLive(m);
  m._stage = STAGE;
  const teams = m.teams.filter(Boolean).map((t) => esc(t.toLowerCase())).join("|");
  // The caption under a box used to read "final" on every played match,
  // which is a label on the thing a score already says. Only the two states
  // a score cannot express get one: it is on now, or it has not started.
  // A match with no kickoff yet still has a day: Liquipedia schedules a
  // stage in prose long before it schedules the matches inside it, so a
  // playoff match reads "18-20 Sept" rather than "TBD".
  const win = windowOf(STAGE);
  const when = m.startsAt ? timeOf(m.startsAt) : win ? `${win}` : "TBD";
  const cap = live ? `<div class="when on" style="left:${x + 3}px;top:${y + BOX_H + 4}px">live now</div>`
    : done ? ""
    : `<div class="when${m.startsAt ? "" : " soft"}" style="left:${x + 3}px;top:${y + BOX_H + 4}px">${when}</div>`;
  return `<div class="m ${m.section ?? "final"}${live ? " live" : ""}" data-teams="${teams}" data-mi="${m._i}" tabindex="0" ` +
      `style="left:${x}px;top:${y}px;width:${BOX_W}px">` +
      side(m.teams[0], a, st(a, b)) + side(m.teams[1], b, st(b, a)) +
    `</div>` + cap;
}

const bracketEl = (b) => {
  const L = layoutBracket(b.matches, b.edges);
  const parts = [];
  for (const c of L.cols) {
    const x = c.col * COL;
    parts.push(`<div class="rhead ${c.section}" style="left:${x}px;top:${(L.y.get(slotOf(c.matches[0])) ?? TOP) - HEAD_H - 8}px;width:${BOX_W}px;height:${HEAD_H}px">${esc(c.label)}</div>`);
    for (const m of c.matches) parts.push(matchBox(m, x, L.y.get(slotOf(m))));
  }
  // The qualified slots, and the short wire into each.
  if (L.quals.length) {
    const x = Math.min(...L.quals.map((q) => q.col)) * COL;
    const top = Math.min(...L.quals.map((q) => q.y));
    parts.push(`<div class="rhead final" style="left:${x}px;top:${top - HEAD_H - 8}px;width:${BOX_W}px;height:${HEAD_H}px">Qualified</div>`);
  }
  for (const q of L.quals) {
    const x = q.col * COL;
    const [a, b] = q.m.scores;
    // Only a finished series sends anyone through. This slot filled itself
    // from a live 2-1 before.
    const done = q.m.finished && a !== null && b !== null;
    const who = done ? (a > b ? q.m.teams[0] : q.m.teams[1]) : null;
    parts.push(`<div class="qual${who ? " in" : ""}" style="left:${x}px;top:${q.y + (BOX_H - 30) / 2}px;width:${BOX_W}px">` +
      (who ? `${crest(who)}<span>${esc(teamName(who))}</span>` : `<span class="tbd">TBD</span>`) + `</div>`);
    const xPrev = x - GUTTER;
    parts.push(`<div class="wire" style="left:${xPrev}px;top:${q.y + BOX_H / 2}px;width:${GUTTER}px;height:1px"></div>`);
  }
  for (const k of L.links) {
    const xPrev = k.col * COL - GUTTER, mid = xPrev + GUTTER / 2;
    const c = k.from.map((v) => v + BOX_H / 2).sort((a, b) => a - b);
    const to = k.to + BOX_H / 2;
    for (const v of c) parts.push(`<div class="wire" style="left:${xPrev}px;top:${v}px;width:${GUTTER / 2}px;height:1px"></div>`);
    // The vertical has to reach the destination as well as span the feeders:
    // a single-feeder step has nothing to span, and a cross-band one reaches
    // a long way.
    const top = Math.min(...c, to), bottom = Math.max(...c, to);
    if (bottom > top) parts.push(`<div class="wire" style="left:${mid}px;top:${top}px;width:1px;height:${bottom - top}px"></div>`);
    parts.push(`<div class="wire" style="left:${mid}px;top:${to}px;width:${GUTTER / 2}px;height:1px"></div>`);
  }
  return `<div class="scrollwrap dwrap"><span class="hint">scroll &rarr;</span>` +
    `<div class="scroll"><div class="bk" style="height:${L.height}px;width:${L.width}px">${parts.join("")}</div></div></div>`;
};

// The same bracket on a phone.
//
// The desktop diagram is 1220px of fixed geometry and does not survive 335px
// of screen: scaled to fit it is unreadable, and left alone it is four
// sideways swipes to reach the final.
//
// What replaced it first was a list - one column per round, snapped like a
// pager - and a list of rounds is not a bracket. It lost the two things a
// bracket is for: which match feeds which, and who came through. So this is
// the real diagram again, drawn at a size a phone can read: the SAME layout
// engine as the desktop, given a geometry where exactly two round columns fit
// the screen, with the wires and the qualified slots intact.
//
// Same data, same data-mi, so tapping a box opens the same series card.

// "Upper Bracket Quarterfinals" does not fit a column half a phone wide. The
// lane prefixes shorten, the round itself does not: "UB Quarterfinals" is
// what a bracket has always called it, and "UB Quarters" was losing a word to
// save four characters.
const shortRound = (name) => String(name)
  .replace(/^Upper Bracket\s*/i, "UB ")
  .replace(/^Lower Bracket\s*/i, "LB ")
  .trim();

function phoneBox(m, x, y, G) {
  const [a, b] = m.scores;
  const live = isLive(m);
  const played = m.finished || live;
  const done = m.finished && a !== null && b !== null;
  m._stage = STAGE;
  // The date and the time on their own line at the top of the box. A match
  // with no kickoff published yet still has the days its stage runs, which is
  // true and is better than an empty line.
  const win = windowOf(STAGE);
  const when = m.startsAt
    ? `${shortDay(m.startsAt.slice(0, 10))} · ${clockOf(m.startsAt)}`
    : m.startsOn ? shortDay(m.startsOn)
    : win ? win : "Time TBD";
  const row = (i) => {
    const name = m.teams[i];
    const seed = Boolean(m.seeds?.[i]);
    const mine = i === 0 ? a : b, other = i === 0 ? b : a;
    // Only a finished series has a winner. A Bo7 at 3-2 shows the score with
    // neither row emphasised, the same rule the diagram uses.
    const cls = !done || mine === null || other === null ? ""
      : mine > other ? " won" : " lost";
    return `<div class="pmt${cls}${name ? "" : " tbd"}">` +
      `<span class="pmn">${seed ? "" : teamMark(name)}<span>${esc(teamName(name) ?? "TBD")}</span></span>` +
      `<span class="pms">${played && mine !== null ? esc(mine) : "&middot;"}</span></div>`;
  };
  return `<div class="pm ${m.section ?? "final"}${live ? " onair" : ""}" data-mi="${m._i}" tabindex="0" ` +
      `style="left:${x}px;top:${y}px;width:${G.BOX_W}px;height:${G.BOX_H}px">` +
    `<div class="pmwhen">${esc(live ? "Live now" : when)}</div>${row(0)}${row(1)}</div>`;
}

// Which pages a bracket is read in on a phone.
//
// One long sideways scroll meant hunting for the part you wanted by dragging
// past the parts you did not. So the bracket is dealt into pages instead: two
// round columns each, one screen wide, snapped, with a strip of names above
// them. The part you want is one tap away.
//
// A page holds columns from ONE band, so the upper bracket, the lower bracket
// and the finals never share one. Qualifiers become a page of their own at the
// end: a play-in exists to produce them, and they are what it is opened for.
function phonePages(b) {
  const pages = [];
  for (const band of ["upper", "lower", "final"]) {
    const ms = b.matches.filter((m) => (m.section ?? "final") === band);
    if (!ms.length) continue;
    const rounds = [...new Set(ms.map((m) => m.round))].sort((x, y) => x - y);
    for (let i = 0; i < rounds.length; i += 2) {
      const take = rounds.slice(i, i + 2);
      pages.push({ matches: ms.filter((m) => take.includes(m.round)) });
    }
  }
  return pages;
}

// Everyone this bracket sends through, in bracket order. Only a finished
// series sends anyone: a live 2-1 filled this in once.
function qualifiersOf(b) {
  return b.matches
    .filter((m) => b.edges?.[slotOf(m)]?.qualifies)
    .sort((x, y) => x.round - y.round || x.position - y.position)
    .map((m) => {
      const [a, c] = m.scores;
      const done = m.finished && a !== null && c !== null;
      return { from: m.label ?? "", who: done ? (a > c ? m.teams[0] : m.teams[1]) : null };
    });
}

function bracketPhone(b) {
  const G = { ...phoneGeo(), quals: false };
  const pages = phonePages(b).map((pg) => {
    const L = layoutBracket(pg.matches, b.edges, G);
    const cols = [...L.cols].sort((x, y) => x.round - y.round);
    const parts = [];
    for (const c of L.cols) {
      const x = c.col * G.COL;
      const top = (L.y.get(slotOf(c.matches[0])) ?? G.TOP) - G.HEAD_H - 6;
      parts.push(`<div class="prhead ${c.section}" style="left:${x}px;top:${top}px;width:${G.BOX_W}px;height:${G.HEAD_H}px">${esc(shortRound(c.label))}</div>`);
      for (const m of c.matches) parts.push(phoneBox(m, x, L.y.get(slotOf(m)), G));
    }
    // The connectors, drawn down the gutter between the two columns: the half
    // that leaves each feeder, the vertical that joins them, and the half that
    // arrives at the match they feed.
    for (const k of L.links) {
      const xPrev = k.col * G.COL - G.GUTTER, mid = xPrev + G.GUTTER / 2;
      const c = k.from.map((v) => v + G.BOX_H / 2).sort((x, y) => x - y);
      const to = k.to + G.BOX_H / 2;
      for (const v of c) parts.push(`<div class="wire" style="left:${xPrev}px;top:${v}px;width:${G.GUTTER / 2}px;height:1px"></div>`);
      const top = Math.min(...c, to), bottom = Math.max(...c, to);
      if (bottom > top) parts.push(`<div class="wire" style="left:${mid}px;top:${top}px;width:1px;height:${bottom - top}px"></div>`);
      parts.push(`<div class="wire" style="left:${mid}px;top:${to}px;width:${G.GUTTER / 2}px;height:1px"></div>`);
    }
    return {
      label: shortRound(cols[0]?.label ?? "Matches"),
      html: `<div class="pbk" style="height:${L.height}px;width:${L.width}px">${parts.join("")}</div>`,
    };
  });

  const quals = qualifiersOf(b);
  if (quals.length) {
    const rows = quals.map((q) =>
      `<li class="pqual${q.who ? " in" : ""}">` +
      (q.who ? `${teamMark(q.who)}<span>${esc(teamName(q.who))}</span>` : `<span class="tbd">TBD</span>`) +
      `</li>`).join("");
    pages.push({ label: "Qualified", html: `<ul class="pquals">${rows}</ul>` });
  }

  // One page is not a pager. A 1v1 that is two semifinals and a final fits on
  // a single screen, and a strip of one name above it says nothing.
  if (pages.length < 2) {
    return `<div class="pbrk one"><div class="ppages">` +
      `<section class="ppage">${pages[0]?.html ?? ""}</section></div></div>`;
  }
  const tabs = pages.map((pg, i) =>
    `<button type="button" class="ptab" role="tab" aria-selected="${i === 0}">${esc(pg.label)}</button>`).join("");
  const sheets = pages.map((pg) => `<section class="ppage">${pg.html}</section>`).join("");
  return `<div class="pbrk">` +
    `<div class="ptabs" role="tablist" aria-label="Part of the bracket">${tabs}</div>` +
    `<div class="ppages">${sheets}</div></div>`;
}

// The page strip: which page is on screen, and tapping a name goes to it.
function wirePagers() {
  for (const brk of document.querySelectorAll(".pbrk")) {
    const pages = brk.querySelector(".ppages");
    const strip = brk.querySelector(".ptabs");
    if (!pages || !strip) continue;
    const tabs = [...strip.querySelectorAll(".ptab")];

    const apply = (i) => {
      tabs.forEach((t, n) => t.setAttribute("aria-selected", String(n === i)));
      const on = tabs[i];
      // Keep the selected name in view without scrollIntoView, which would
      // scroll the whole page as well as the strip.
      if (on) strip.scrollLeft = Math.max(0, on.offsetLeft - (strip.clientWidth - on.offsetWidth) / 2);
      // The pager is as tall as the page under it, not as tall as the tallest
      // page there is. A two-match round left 500px of empty page below it
      // because the lower bracket next door needed the room.
      const sheet = pages.children[i];
      if (sheet) pages.style.height = `${sheet.scrollHeight}px`;
    };

    // A swipe reports where it landed; a tap says where it is going. The tap
    // marks itself rather than waiting for the scroll to arrive, so the strip
    // answers immediately and still agrees if the scroll is interrupted.
    pages.addEventListener("scroll", () => {
      apply(Math.round(pages.scrollLeft / Math.max(1, pages.clientWidth)));
    }, { passive: true });
    strip.addEventListener("click", (e) => {
      const t = e.target.closest(".ptab");
      if (!t) return;
      const i = tabs.indexOf(t);
      apply(i);
      pages.scrollTo({ left: i * pages.clientWidth, behavior: "smooth" });
    });
    apply(0);
  }
}

function tableEl(table, matches) {
  const rows = standings(table, matches);
  if (!rows.length) return "";
  const played = rows.some((r) => r.played);
  const body = rows.map((r) => {
    // While a group is unplayed, colour what the place WILL mean rather than
    // nothing: "first advances" is the most useful thing a table can say
    // before a ball is hit.
    const mark = r.outcome ?? (played ? null : r.meansIfHere);
    const cls = mark === "down" ? "down"
      : /^(up|stay|stayup|seedup)$/.test(mark ?? "") ? "up" : "";
    return `<tr class="${cls}${r.team ? "" : " tbdrow"}">` +
      `<td class="pos">${r.rank}</td>` +
      `<td><span class="nm">${crest(r.team)}${esc(r.team ?? "TBD")}</span></td>` +
      `<td class="rec">${r.played ? `${r.won}&ndash;${r.lost}` : "&middot;"}</td>` +
      `<td class="gd">${r.played ? (r.diff > 0 ? `+${r.diff}` : r.diff) : "&middot;"}</td></tr>`;
  }).join("");
  return `<table class="tbl"><thead><tr><th></th><th>Team</th><th>W&ndash;L</th><th>GD</th></tr></thead>` +
    `<tbody>${body}</tbody></table>`;
}

function groupEl(ml, table) {
  const rows = [];
  for (const m of ml.matches) {
    if (m.label) rows.push(`<div class="gsub">${esc(m.label)}</div>`);
    const [a, b] = m.scores, played = m.finished || m.live;
    const done = m.finished;
    const wa = done && a !== null && b !== null && a > b, wb = done && a !== null && b !== null && b > a;
    // Crest, name, score, name, crest: the same reading order as a match box
    // in the bracket above, so the two do not have to be learned separately.
    const score = played
      ? `<b class="${wa ? "w" : ""}">${a}</b><i>&ndash;</i><b class="${wb ? "w" : ""}">${b}</b>`
      : `<span class="vs">vs</span>`;
    m._stage = STAGE;
    rows.push(`<div class="gm" data-mi="${m._i}" tabindex="0">` +
      `<span class="t${wa ? " won" : ""}${m.teams[0] ? "" : " tbd"}">${crest(m.teams[0])}<span>${esc(m.teams[0] ?? "TBD")}</span></span>` +
      `<span class="sc">${score}</span>` +
      `<span class="t r${wb ? " won" : ""}${m.teams[1] ? "" : " tbd"}">${crest(m.teams[1])}<span>${esc(m.teams[1] ?? "TBD")}</span></span></div>`);
  }
  // How many places advance, stated once at the top rather than left to be
  // inferred from the colour of a rail.
  const cap = `<span>${esc((ml.title ?? "Group").replace(/ Matches$/, ""))}</span>`;
  return `<div class="gcard"><div class="cap">${cap}</div>` +
    tableEl(table, ml.matches) +
    `<div class="gsplit"></div>${rows.join("")}</div>`;
}

// ---- events ---------------------------------------------------------------

const load = async () =>
  (await fetch("/data/bracket.json?v=" + Date.now(), { cache: "no-store" })).json();

let doc = await load();

// Newest first. An event with no dates yet sorts to the front rather than
// vanishing off the end.
const byNewest = (list) =>
  [...list].sort((a, b) => String(b.starts ?? "9999").localeCompare(String(a.starts ?? "9999")));
let EVENTS = byNewest(doc.events);

const startMs = (e) => Date.parse(`${e.starts}T00:00:00Z`);
const endMs = (e) => Date.parse(`${e.ends}T23:59:59Z`);
// Running is decided by eventRunning, not by the UTC date: the dates are the
// venue's, and a North American final runs past midnight UTC.
const stateOf = (e, now = Date.now()) => {
  if (eventRunning(e, now)) return "running";
  if (!Number.isFinite(startMs(e))) return "tbd";
  if (now > endMs(e)) return "past";
  return "future";
};

// What the page opens on: whatever is running, else the next one up, else the
// most recent. Opening a finished 2024 bracket during Worlds would be absurd.
function defaultEvent() {
  const running = EVENTS.filter((e) => stateOf(e) === "running");
  if (running.length) return running[0];
  const future = EVENTS.filter((e) => stateOf(e) === "future").sort((a, b) => startMs(a) - startMs(b));
  if (future.length) return future[0];
  return EVENTS[0];
}

// The event switcher: a season, then that season's LANs.
//
// It used to be one horizontal strip of every LAN ever, which scrolled
// sideways and got clunkier with each season added - by 2028 it would be
// fifteen chips behind a scrollbar.
//
// Liquipedia solves the same problem with two rows rather than one: a
// seasons navbox (Season 1 ... 2024 2025 2026) above a tab strip of that
// season's events (Finals, Kick-Off Weekend, Boston Major, Paris Major).
// Three LANs a season means three tabs, which fit on any screen and never
// scroll. VLR.gg adds the thing Liquipedia lacks - a status on each entry -
// so live and upcoming stay obvious. This is that shape, in this page's own
// furniture.

const yearOf = (e) => String(e.starts ?? "").slice(0, 4) || "—";

// Newest season first, and each season's events newest first inside it.
function seasons() {
  const by = new Map();
  for (const e of EVENTS) {
    const y = yearOf(e);
    if (!by.has(y)) by.set(y, []);
    by.get(y).push(e);
  }
  return [...by.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function railEl(current) {
  const all = seasons();
  const year = yearOf(EVENTS.find((e) => e.slug === current) ?? {});

  // A season, and the season's events inside it.
  //
  // There used to be a second row under the years - one box per event - which
  // was a row of chrome above the event already on screen, and on a phone the
  // years themselves collapsed into a dropdown, which hid the only thing worth
  // keeping visible. Now the years are always the row, and a year OPENS its
  // events. <details> rather than a script: it works with none.
  const menus = all.map(([y, evs]) => {
    const live = evs.some((e) => stateOf(e) === "running");
    const soon = evs.some((e) => stateOf(e) === "future");
    const items = evs.map((e) => {
      const st = stateOf(e);
      const cls = st === "running" ? " islive" : st === "future" ? " isnext" : "";
      const span = e.starts && e.ends ? spanWords({ from: e.starts, to: e.ends }) : "dates TBC";
      const label = st === "running" ? "On now"
        : st === "future" ? `${span} &middot; upcoming`
        : `${span} &middot; ${esc(cityOf(e) ?? "")}`;
      // "RLCS 2026" is dropped: the season is the button this menu hangs off
      // and the page is nothing but RLCS events.
      const name = String(e.name ?? e.slug).replace(/^RLCS\s+\d{4}\s*/, "");
      return `<button type="button" class="evi${cls}" data-slug="${esc(e.slug)}" ` +
        `aria-current="${e.slug === current ? "true" : "false"}"><b>${esc(name)}</b><i>${label}</i></button>`;
    }).join("");
    return `<details class="ydd"><summary class="yr${y === year ? " on" : ""}${live ? " islive" : soon ? " isnext" : ""}">` +
      `${esc(y)}</summary><div class="ymenu" role="group" aria-label="Events in ${esc(y)}">${items}</div></details>`;
  }).join("");

  return `<div class="years" role="group" aria-label="Season">${menus}</div>`;
}

// ---- each event's own banner ---------------------------------------------
//
// The card that used to sit above every bracket - a pill, a countdown and the
// next fixture - is gone. The schedule column beside the bracket says all of
// it, against the matches it is about, and two things counting down to the
// same event on one screen is one too many.

// The banner for the event actually on screen. A finished LAN gets its
// result, a running one its hero card. The hero above already carries the
// countdown, so this never repeats it.
function countEl(ev) {
  const st = stateOf(ev);

  if (st === "past") {
    const f = finalOf(ev);
    if (!f) return "";
    const [w, l] = f.scores[0] > f.scores[1] ? [0, 1] : [1, 0];
    return `<section class="result" aria-label="Result">
      <div class="win">
        ${crest(f.teams[w], "xl")}
        <div>
          <span class="lab">Champion</span>
          <b>${esc(f.teams[w] ?? "")}</b>
        </div>
      </div>
      <div class="score">
        <span class="s">${f.scores[w]}</span><i>&ndash;</i><span class="s dim">${f.scores[l]}</span>
        <span class="cap">Grand final</span>
      </div>
      <div class="lose">
        ${crest(f.teams[l], "big")}
        <div><span class="lab">Runner-up</span><b>${esc(f.teams[l] ?? "")}</b></div>
      </div>
    </section>`;
  }

  if (st === "tbd") return `<div class="count"><span class="lab">Dates</span><span class="note">Not announced yet.</span></div>`;

  // A running or upcoming event gets nothing here. It used to get a strip
  // saying "Under way" and the date range, which the masthead's own subtitle
  // and the schedule column both already carry, and which was the last piece
  // of the banner that sat between the event tabs and the first bracket.
  return "";
}

// The schedule column, for the event on screen.
//
// Drawn from the same parsed matches as the bracket beside it, so the two can
// never disagree. Repainted on its own slow timer as well as on every render:
// "in 4 min" goes stale between polls even when the feed has not changed.
// ---- the phone's three panes ----------------------------------------------
//
// A phone gets the event as Overview, Schedule and Info rather than one long
// scroll: the diagram and the standings, the fixtures by day, and what the
// thing is worth. The panes are all in the page and a body class chooses, so
// switching costs no rebuild and the back button is not involved.
let PANE = "bracket";
let WHEN = "upcoming";   // which half of the schedule pane

function paintPanes() {
  const ev = EVENTS.find((e) => e.slug === CURRENT);
  if (!ev) return;
  const head = document.getElementById("ehead");
  if (head) head.innerHTML = headerHTML(ev);
  const sched = document.getElementById("paneFixtures");
  if (sched) sched.innerHTML = scheduleHTML(ev, Date.now(), WHEN);
  const teams = document.getElementById("paneTeams");
  if (teams) teams.innerHTML = teamsHTML(ev);
  const prizes = document.getElementById("panePrizes");
  if (prizes) prizes.innerHTML = prizesHTML(ev);
  // The cards are new nodes every paint, so they are wired here rather than in
  // wire(), which runs once per render.
  if (sched) for (const el of sched.querySelectorAll("[data-mi]")) bindMatch(el);
  showPane(PANE);
}

function showPane(name) {
  PANE = name;
  for (const b of document.querySelectorAll("#etabs button")) {
    b.setAttribute("aria-selected", String(b.dataset.pane === name));
  }
  document.body.classList.remove("pane-bracket", "pane-fixtures", "pane-teams", "pane-prizes");
  document.body.classList.add("pane-" + name);
}

document.getElementById("etabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-pane]");
  if (!b) return;
  showPane(b.dataset.pane);
  window.scrollTo({ top: 0 });
});

// The Upcoming / Finished switch inside the schedule pane.
document.getElementById("paneFixtures").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-when]");
  if (!b) return;
  WHEN = b.dataset.when;
  paintPanes();
});

function paintSchedule() {
  const box = document.getElementById("sched");
  if (!box) return;
  const ev = EVENTS.find((e) => e.slug === CURRENT);
  const compact = window.matchMedia("(max-width:700px)").matches;
  const html = ev ? panelHTML(ev, Date.now(), { compact }) : "";
  box.innerHTML = html;
  box.hidden = !html;
  document.body.classList.toggle("hassched", Boolean(html));
}
setInterval(() => { paintSchedule(); paintPanes(); }, 15e3);

// ---- hover card -----------------------------------------------------------

const card = document.createElement("div");
card.className = "card";
document.body.appendChild(card);

const bestOf = (m, st) => {
  // The Format section states the series length per stage ("All matches are
  // Bo7"), which is the authority. The {{Map}} count is the fallback: the
  // template carries one per possible game, so it is the series length
  // rather than the games played.
  const n = st?.bestOf ?? (m.maps?.length >= 2 ? m.maps.length : null);
  return n ? `Best of ${n}` : null;
};

function cardHTML(m) {
  const day = dayOf(m.startsAt);
  const [a, b] = m.scores;
  const played = m.finished && a !== null && b !== null;
  const live = isLive(m);
  const st = m._stage ?? null;
  const win = windowOf(st);
  const head = live ? `<b>Live now</b>`
    : day ? `<b>${esc(day)}</b>${clockOf(m.startsAt) ? ` &middot; ${esc(clockOf(m.startsAt))}` : ""}`
    : win ? `<b>${esc(win)}</b> &middot; time to be confirmed`
    : `<b>Time to be confirmed</b>`;
  const mid = played
    ? `<span class="${a > b ? "w" : ""}">${a}</span>&thinsp;&ndash;&thinsp;<span class="${b > a ? "w" : ""}">${b}</span>`
    : live ? `${a ?? 0}&thinsp;&ndash;&thinsp;${b ?? 0}` : "vs";
  const sd = (t, mine, other) => {
    const beat = played && mine !== null && other !== null && mine < other;
    return `<span class="sd${beat ? " beat" : ""}">${crest(t, "big")}<span>${esc(t ?? "TBD")}</span></span>`;
  };
  // Where to watch. The per-match twitch/youtube fields carry a display name
  // ("Rocket League"), not a channel, so the channels come from the event's
  // infobox - it is one broadcast for the whole page. blast.tv is per match
  // and goes to that series, so it stays the third, quieter link.
  const ev = EVENTS.find((e) => e.slug === CURRENT) ?? {};
  const links = [];
  if (!played) {
    if (ev.twitch) links.push(`<a class="watch tw" href="https://www.twitch.tv/${esc(ev.twitch)}" target="_blank" rel="noopener">Watch here</a>`);
    if (ev.youtube) links.push(`<a class="watch yt" href="https://www.youtube.com/${esc(ev.youtube)}/live" target="_blank" rel="noopener">Watch here</a>`);
  }
  if (m.blasttv) links.push(`<a class="watch alt" href="https://blast.tv/${esc(m.blasttv)}" target="_blank" rel="noopener">${played ? "Series page" : "Series"}</a>`);
  const note = [m.label, bestOf(m, st)].filter(Boolean).map(esc).join(" &middot; ");
  // The games, once any of them has been played. The map name comes from the
  // {{Map}} block's own map= field, so an unnamed game leaves the middle
  // empty rather than inventing "G3". Goal scores sit on the side of the team
  // that scored them, matching the two names above.
  const games = (m.maps ?? []).filter((g) => g.score1 !== null || g.score2 !== null);
  const mapsEl = games.length
    ? `<div class="maps">` + games.map((g) =>
        `<div class="mp"><b class="${g.score1 > g.score2 ? "w" : ""}">${g.score1 ?? "&middot;"}</b>` +
        `<span>${esc(g.name ?? "")}</span>` +
        `<b class="${g.score2 > g.score1 ? "w" : ""}">${g.score2 ?? "&middot;"}</b></div>`).join("") + `</div>`
    : "";
  return `<div class="day">${head}</div>` +
    `<div class="fx">${sd(m.teams[0], a, b)}<span class="mid${played || live ? "" : " pending"}">${mid}</span>${sd(m.teams[1], b, a)}</div>` +
    mapsEl +
    (note ? `<div class="note">${note}</div>` : "") +
    (links.length ? `<div class="foot">${links.join("")}</div>` : "");
}

let cardFor = null;
let cardTimer = null;

// Leaving the box does not close the card straight away, and entering the
// card cancels the close. Without this the buttons are unreachable: the
// pointer has to cross the gap between the box and the card, and the card
// vanished the moment it left the box. Clicking removed that problem, so
// closing is immediate.
const closeSoon = () => hideCard();

function showCard(el) {
  clearTimeout(cardTimer);
  const m = MATCHES[Number(el.dataset.mi)];
  if (!m) return;
  cardFor = el;
  card.innerHTML = cardHTML(m);
  card.classList.add("on");
  place(el);
}
function place(el) {
  const r = el.getBoundingClientRect();
  const w = card.offsetWidth, h = card.offsetHeight;
  const PAD = 8;
  // clientWidth/clientHeight, not innerWidth/innerHeight: those include the
  // scrollbars, which is how the card ended up a scrollbar's width off the
  // right edge.
  // clientWidth/clientHeight are zero while the document is not being
  // rendered (a hidden tab or pane), and clamping against zero collapses the
  // card into the corner. Fall back to the window in that case.
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;

  // Above the box by preference, like Liquipedia, overlapping it by a pixel
  // rather than leaving a gap - the pointer has to travel from the box into
  // the card without crossing dead space, or the buttons cannot be reached.
  //
  // Below when there is no room above, then clamped to the viewport in both
  // directions: a card taller than the space under a box near the bottom of
  // the screen used to hang off the edge with its buttons unreachable.
  const above = r.top - h + 1;
  const below = r.bottom - 1;
  let top = above >= PAD ? above : (below + h + PAD <= vh ? below : Math.max(PAD, vh - h - PAD));
  top = Math.min(Math.max(PAD, top), Math.max(PAD, vh - h - PAD));

  let left = r.left + r.width / 2 - w / 2;
  left = Math.min(Math.max(PAD, left), Math.max(PAD, vw - w - PAD));

  card.style.top = `${top}px`;
  card.style.left = `${left}px`;
}
function hideCard() { clearTimeout(cardTimer); card.classList.remove("on"); cardFor = null; }

// ---- render ---------------------------------------------------------------

// Cities people know. Liquipedia gives the administrative municipality, which
// is accurate and unhelpful: the Paris Major was in Nanterre and the 2025
// Worlds in Decines-Charpieu, and nobody calls them that.
const CITY = {
  "Nanterre": "Paris",
  "Décines-Charpieu": "Lyon",
  "Decines-Charpieu": "Lyon",
};
const cityOf = (ev) => CITY[ev.city] ?? ev.city ?? null;

// A bracket's name, from the heading it sits under on Liquipedia, then from
// what it contains. "Bracket 1" told a reader nothing, and the match count
// beside it was a number nobody needs next to a diagram that shows every match.
//
// Position is the last resort and used to be the first. "The first of several
// brackets is the play-in" holds for the 2025 and 2026 Worlds and fails for
// 2024, where the first bracket is the two-series Swiss Tiebreaker that set the
// 3rd, 4th and 5th seeds - shown for months as a play-in that season never ran.
function bracketName(b, i, all) {
  if (b.title) return b.title;
  const labels = b.matches.map((m) => (m.label ?? "").toLowerCase());
  if (labels.some((l) => l.includes("grand final") || l === "final")) return "Playoffs";
  if (all.length > 1 && i === 0) return "Play-In";
  return all.length > 1 ? `Stage ${i + 1}` : "Playoffs";
}

function render(slug) {
  const ev = EVENTS.find((e) => e.slug === slug) ?? defaultEvent();
  CURRENT = ev.slug;
  SCHED = ev.stages.flatMap((st) => st.schedule ?? []);
  MATCHES = matchesOf(ev);
  MATCHES.forEach((m, i) => { m._i = i; });
  assignHues(MATCHES.flatMap((m) => m.teams));

  document.title = `${ev.name} — bracket`;
  document.getElementById("title").textContent = ev.name ?? ev.slug;
  // Where it is and what it is worth. The date range and the match count used
  // to be here too: the dates are in the rail and the countdown, and a
  // progress count belongs nowhere near a masthead.
  document.getElementById("meta").textContent = [
    [cityOf(ev), ev.country].filter(Boolean).join(", "),
    ev.venue,
    ev.prizePool ? `$${ev.prizePool}` : null,
  ].filter(Boolean).join(" · ");
  // CC-BY-SA wants the source named and the licence linked, not just the
  // words "CC-BY-SA" printed. Both are links, and the build stamp says how
  // fresh this copy of the data is.
  const when = new Date(doc.generatedAt);
  document.getElementById("attr").innerHTML =
    `Bracket data from <a href="https://liquipedia.net/rocketleague/" target="_blank" rel="noopener">Liquipedia</a>, ` +
    `used under <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener">CC BY-SA 3.0</a>. ` +
    `Last updated ${esc(when.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}.`;
  // The current or next LAN comes first whatever is being browsed. When it
  // IS what is being browsed, its card sits under its own masthead instead
  // of naming the same event twice, one above the other.
  document.getElementById("rail").innerHTML = railEl(ev.slug);
  paintSchedule();
  paintPanes();
  document.getElementById("count").innerHTML = countEl(ev);

  // Sections in the order they are PLAYED, from the page's own Format
  // section: Play-In on the 15th, groups on the 16th-17th, playoffs on the
  // 18th-20th. The wikitext lists the play-in bracket, then the groups, then
  // the playoff bracket, so reading it in document order put the group stage
  // before the play-in that fills it.
  const sections = [];
  for (const stage of ev.stages) {
    if (stage.matchlists.length) {
      const name = stage.tables.length ? "Group stage" : "Swiss stage";
      sections.push({
        name,
        stage: stageFor(name),
        format: stage.format ?? null,
        draw: () => {
          const paired = pairGroups(stage.tables, stage.matchlists);
          // The count rides on the element so the CSS can keep the rows even.
          // Four groups in a three-wide grid leaves one alone on a second row,
          // which reads as an afterthought rather than as Group D.
          return `<div class="groups g${paired.length}">${paired.map(({ list, table }) => groupEl(list, table)).join("")}</div>`;
        },
      });
    }
    stage.brackets.forEach((b, i) => {
      // A side discipline gets named by what it is. The 2026 1v1 page heads its
      // only bracket "Results", which as a section title on a page of brackets
      // says nothing; "1v1" says the thing that actually separates it from
      // everything above it.
      const solo = stage.format && stage.format !== "3v3";
      const name = solo ? stage.format : bracketName(b, i, stage.brackets);
      // Both shapes are rendered and CSS picks one: the diagram on a screen
      // with room for it, the list on a phone. Rendering both costs a few KB
      // of markup and means a rotation needs no rebuild.
      sections.push({
        name, stage: stageFor(name), format: stage.format ?? null,
        draw: () => bracketEl(b) + bracketPhone(b),
      });
    });
  }
  sections.sort((a, b) => (a.stage?.from ?? "9999").localeCompare(b.stage?.from ?? "9999"));

  const out = [];
  for (const sec of sections) {
    // Set before drawing: an undated match reads its stage window from here,
    // and a match box reads its discipline.
    STAGE = sec.stage;
    FORMAT = sec.format ?? null;
    const win = windowOf(sec.stage);
    out.push(`<h2 class="stage">${esc(sec.name)}${win ? `<span>${win}</span>` : ""}</h2>`);
    out.push(sec.draw());
  }
  STAGE = null;
  FORMAT = null;
  document.getElementById("out").innerHTML = out.join("");

  hideCard();
  wire();
  wirePagers();
  fitBrackets();
  markScrollable();
  history.replaceState(null, "", `#${ev.slug}`);
}

// Trace a team's run: dim every match it is not in.
function trace(team) {
  for (const bk of document.querySelectorAll(".bk")) {
    bk.classList.toggle("tracing", Boolean(team));
    for (const m of bk.querySelectorAll(".m")) {
      m.classList.toggle("onpath", Boolean(team) && (m.dataset.teams || "").split("|").includes(team));
    }
  }
}

let held = null;
// One match element, wired to the series card. Pulled out of wire() because
// the phone's schedule pane draws its own cards after the page has been wired,
// and re-running wire() would bind every existing box a second time.
function bindMatch(el) {
  if (el.dataset.bound) return;
  el.dataset.bound = "1";
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    if (cardFor === el && card.classList.contains("on")) return hideCard();
    showCard(el);
  });
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    if (cardFor === el && card.classList.contains("on")) return hideCard();
    showCard(el);
    const first = card.querySelector("a[href]");
    if (!first) return;
    returnTo = el;
    first.focus();
  });
}

function wire() {
  // Hover traces; a tap holds it, because there is no hover on a phone and the
  // trace is the one thing on this page worth reaching for.
  for (const el of document.querySelectorAll(".side[data-team]")) {
    const t = el.dataset.team;
    el.addEventListener("mouseenter", () => { if (!held) trace(t); });
    el.addEventListener("focus", () => { if (!held) trace(t); });
    el.addEventListener("mouseleave", () => { if (!held) trace(null); });
    el.addEventListener("blur", () => { if (!held) trace(null); });
    el.addEventListener("click", (e) => { e.stopPropagation(); held = held === t ? null : t; trace(held); });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); held = held === t ? null : t; trace(held); }
    });
  }
  // The card: every match box and every group row.
  //
  // Focusing one shows the card, but that alone leaves its buttons
  // unreachable without a mouse: the card is the last element in the body,
  // so Tab from a match box goes to the NEXT match box and never into the
  // card. Enter or Space moves focus into it, Escape comes back out. Same
  // pattern either way round: the card opens, you act, you leave.
  // Click, not hover. A card that opened on hover appeared while the pointer
  // was only crossing a match on its way somewhere else, and it covered the
  // bracket underneath. Clicking says "I want this one"; clicking the same
  // match again, or anywhere off the card, puts it away.
  for (const el of document.querySelectorAll("[data-mi]")) bindMatch(el);
}

// Where Escape puts focus back.
let returnTo = null;
card.addEventListener("focusout", (e) => { if (!card.contains(e.relatedTarget)) closeSoon(); });
card.addEventListener("focusin", () => clearTimeout(cardTimer));
card.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const back = returnTo;
  hideCard();
  returnTo = null;
  if (back) back.focus();
});

// Shrink a bracket that is close to fitting, rather than cutting it.
//
// The geometry is fixed pixels (200px boxes, 44px gutters), so a five-round
// playoff bracket is 1220px wide whatever it is shown in. That fitted the old
// full-width page and does not fit beside a schedule column, and the result
// was the last round sitting off the right edge behind a scrollbar - the round
// that decides the tournament.
//
// So it is scaled down to the width available. Only down to MIN_FIT: past that
// the team names stop being readable, and a bracket nobody can read is worse
// than one that scrolls, so below it the scroll stays.
//
// Layout size is left alone and the space the transform no longer uses is
// taken back with a negative margin, which keeps the section underneath tight
// against it.
// 0.72 is where the 11px team names in a match box land at 8px, which is
// small but still a name. Measured against the case that matters: the five
// round playoff bracket at 1280, the commonest laptop width.
const MIN_FIT = 0.72;

function fitBrackets() {
  for (const bk of document.querySelectorAll(".scroll > .bk")) {
    const box = bk.parentElement;
    // Measured once: after the first scale, the rendered width is the scaled
    // one, and re-reading it would shrink the bracket again on every resize.
    const w = Number(bk.dataset.w ?? (bk.dataset.w = parseFloat(bk.style.width) || bk.offsetWidth));
    const h = Number(bk.dataset.h ?? (bk.dataset.h = parseFloat(bk.style.height) || bk.offsetHeight));
    if (!w || !h) continue;
    // Measure with any previous zoom removed, so one pass cannot feed the next.
    bk.style.zoom = "";
    const avail = box.clientWidth;
    const k = avail / w;
    const use = k < 1 && k >= MIN_FIT ? k : 1;
    if (use === 1) continue;
    // zoom rather than transform: zoom shrinks the LAYOUT box, so the
    // container stops offering a scrollbar for space the bracket no longer
    // occupies and the section below sits straight underneath it. A transform
    // leaves the old box behind, which needed a negative margin and an
    // overflow override to hide, and those two between them were what covered
    // the top of the next section.
    bk.style.zoom = String(use);
  }
}

// A lane whose bracket is wider than the screen gets a fade and a "scroll"
// note, removed once it is scrolled to the end. The board is mobile-first and
// this page was not: at 375px the second column was cut with nothing saying so.
function markScrollable() {
  for (const wrap of document.querySelectorAll(".scrollwrap")) {
    const sc = wrap.querySelector(".scroll");
    if (!sc) continue;
    // Rendered width, not layout width: a scaled bracket fits even though its
    // layout box is still the full size, and the fade has to agree with what
    // the reader can actually see.
    const bk = sc.querySelector(".bk");
    const shown = () => (bk ? bk.getBoundingClientRect().width : sc.scrollWidth);
    const update = () => wrap.classList.toggle("more", shown() - sc.clientWidth - sc.scrollLeft > 8);
    update();
    sc.addEventListener("scroll", update, { passive: true });
  }
}
// The phone bracket's column width is measured from the screen, so a rotation
// changes the geometry it was drawn at. Redraw on a real width change only:
// scrolling a phone fires resize as the address bar collapses, and redrawing
// on that would throw the reader's place away every few pixels of scroll.
let lastW = document.documentElement.clientWidth;
let reflow = null;
addEventListener("resize", () => {
  fitBrackets(); markScrollable(); if (cardFor) place(cardFor);
  const w = document.documentElement.clientWidth;
  if (w === lastW) return;
  lastW = w;
  if (!window.matchMedia("(max-width:820px)").matches) return;
  clearTimeout(reflow);
  reflow = setTimeout(() => render(CURRENT), 180);
});
addEventListener("scroll", () => { if (cardFor) place(cardFor); }, { passive: true });

document.getElementById("rail").addEventListener("click", (e) => {
  // One menu open at a time. Opening a second while the first is still down
  // leaves two lists overlapping the page under them.
  const sum = e.target.closest("summary.yr");
  if (sum) {
    const mine = sum.parentElement;
    for (const d of document.querySelectorAll(".ydd[open]")) if (d !== mine) d.open = false;
    return;
  }
  const b = e.target.closest(".evi");
  if (!b) return;
  // Picking an event closes the menu it was picked from: left open it would
  // cover the event it just opened.
  for (const d of document.querySelectorAll(".ydd[open]")) d.open = false;
  held = null;
  render(b.dataset.slug);
  scrollTo({ top: 0, behavior: "smooth" });
});
// Anywhere off the rail closes an open season menu.
document.addEventListener("click", (e) => {
  if (e.target.closest("#rail")) return;
  for (const d of document.querySelectorAll(".ydd[open]")) d.open = false;
});
// Anywhere else clears a held trace, so it never gets stuck on, and closes
// the series card - the card is opened by a click now, so it has to be
// closeable by one too.
document.addEventListener("click", (e) => {
  if (!e.target.closest(".side[data-team]") && held) { held = null; trace(null); }
  if (!e.target.closest("[data-mi]") && !e.target.closest(".card")) hideCard();
});
addEventListener("hashchange", () => render(location.hash.slice(1)));

// The footer's copyright year, the way status.js does it.
document.getElementById("yr").textContent = String(new Date().getFullYear());

render(location.hash.slice(1) || defaultEvent().slug);

// ---- keep an open page current --------------------------------------------
//
// The clock ticked from the first render, but nothing re-read the data, so a
// tab left open through the play-in still showed four upcoming matches hours
// after they had been decided.
//
// Poll only while the tab is visible, and only redraw when generatedAt has
// actually moved: a redraw on an unchanged document is work for nothing.
// How often to re-read the feed.
//
// The collector publishes every five minutes and the edge holds one upstream
// read for 20 seconds, so 30s while a LAN is on means the page is never more
// than a few seconds behind the published file. Between events nothing can
// change, so polling that often would be pure noise on someone's data.
const LIVE_MS = 30_000;
const IDLE_MS = 5 * 60_000;
let polling = null;
let pollMs = 0;

// Poll fast while the event on screen is being played, or while any event is:
// somebody watching the 2024 bracket during Worlds still wants the schedule
// column to keep up.
const liveNow = () => {
  const ev = EVENTS.find((e) => e.slug === CURRENT);
  return stateOf(ev ?? {}) === "running" || EVENTS.some((e) => stateOf(e) === "running");
};

// Redraw without throwing away what the reader was doing. render() rebuilds
// every node, so an open series card and a scrolled bracket would both reset
// on a refresh that only changed one score. Remember the match the card is on
// and how far each lane is scrolled, then put them back.
function repaint() {
  const openMi = card.classList.contains("on") && cardFor ? cardFor.dataset.mi : null;
  const scrolls = [...document.querySelectorAll(".scrollwrap .scroll, .ppages")].map((el) => el.scrollLeft);
  const y = window.scrollY;

  render(CURRENT);

  document.querySelectorAll(".scrollwrap .scroll, .ppages").forEach((el, i) => {
    if (scrolls[i]) el.scrollLeft = scrolls[i];
  });
  window.scrollTo({ top: y });
  if (openMi === null) return;
  const el = document.querySelector(`[data-mi="${CSS.escape(openMi)}"]`);
  if (el) showCard(el);
}

async function refresh() {
  try {
    const next = await load();
    if (!next?.generatedAt) return;
    if (next.generatedAt !== doc.generatedAt) {
      doc = next;
      EVENTS = byNewest(doc.events);
      repaint();
    }
  } catch {
    // A failed poll is not worth surfacing: the page keeps showing the data
    // it already has and tries again on the next tick.
  }
  // Cadence follows the event, and the event state changes on its own as a
  // LAN starts: re-arm after every poll rather than once at load.
  startPolling();
}

function startPolling() {
  const want = liveNow() ? LIVE_MS : IDLE_MS;
  if (polling && want === pollMs) return;
  stopPolling();
  pollMs = want;
  polling = setInterval(refresh, want);
}
function stopPolling() {
  if (polling) clearInterval(polling);
  polling = null;
  pollMs = 0;
}

// Coming back to the page is the moment a stale score is most obvious, so
// catch up immediately rather than waiting out the rest of an interval. A tab
// switch fires visibilitychange, moving to another window fires focus alone,
// and a laptop waking from sleep fires neither reliably - pageshow does.
const catchUp = () => { if (!document.hidden) refresh(); };
document.addEventListener("visibilitychange", () => (document.hidden ? stopPolling() : catchUp()));
addEventListener("focus", catchUp);
addEventListener("pageshow", catchUp);
addEventListener("online", catchUp);
if (!document.hidden) startPolling();

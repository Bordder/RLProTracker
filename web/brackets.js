import { crest, assignHues, hasLogo } from "/crest.mjs";
import { standings, pairGroups } from "/standings.mjs";
import { panelHTML, ordinal } from "/fixtures.mjs";

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
const shortDay = (d) => d ? new Date(`${d}T12:00:00Z`).toLocaleDateString([], { day: "numeric", month: "short" }) : "";
const clockOf = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

const BOX_W = 200, GUTTER = 44, ROW_H = 26, BOX_H = ROW_H * 2 + 2;
const SLOT = BOX_H + 30, HEAD_H = 26, TOP = HEAD_H + 10, COL = BOX_W + GUTTER;
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

// "18-20 Sept", or "15 Sept" for a single day.
function windowOf(st) {
  if (!st?.from) return null;
  const d = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString([], { day: "numeric", month: "short" });
  return st.to && st.to !== st.from ? `${new Date(`${st.from}T12:00:00Z`).getUTCDate()}–${d(st.to)}` : d(st.from);
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
// Between the upper band and the lower one. It has to clear the kickoff
// caption that hangs under the last box as well as the box itself, or the
// lower band's round heading lands on top of it - which it did at exactly
// 34, with the caption at y346 and the heading at y342.
const BAND_GAP = 44;
const CAP_H = 18;         // the caption under a box

function layoutBracket(matches, edges) {
  const rounds = matches.map((m) => m.round);
  const minRound = Math.min(...rounds);
  const colOf = (m) => m.round - minRound;

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

  const feeders = (m) => {
    const e = edges?.[slotOf(m)];
    if (!e) return [];
    return [e.upper, e.lower].filter(Boolean).filter((k) => y.has(k)).map((k) => y.get(k));
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
      const step = first ? SLOT : Math.max(SLOT, (bottom - top) / Math.max(1, c.matches.length));
      want.forEach((v, i) => { if (v === null) want[i] = top + i * step; });

      // Keep a column in order and never overlapping, without moving a match
      // off its feeders unless it has to.
      const idx = want.map((_, i) => i).sort((a, b) => want[a] - want[b]);
      let floor = -Infinity;
      for (const i of idx) {
        want[i] = Math.max(want[i], floor);
        floor = want[i] + BOX_H + 14;
      }
      c.matches.forEach((m, i) => y.set(slotOf(m), want[i]));
      bottom = Math.max(bottom, ...want.map((v) => v + BOX_H + CAP_H));
      first = false;
    }
    return bottom;
  };

  const upperBottom = placeBand("upper", TOP);
  const lowerBottom = placeBand("lower", (order.some((c) => c.section === "upper") ? upperBottom + BAND_GAP : TOP));
  const full = Math.max(upperBottom, lowerBottom);

  // Finals sit against their feeders, which normally means between the two
  // bands. With no edge list, centre them instead of stacking them at the top.
  for (const c of order.filter((x) => x.section === "final")) {
    const want = c.matches.map((m) => {
      const f = feeders(m);
      return f.length ? f.reduce((a, b) => a + b, 0) / f.length : null;
    });
    const span = full - TOP;
    want.forEach((v, i) => {
      if (v !== null) return;
      const n = c.matches.length;
      want[i] = TOP + span / 2 - BOX_H / 2 + (i - (n - 1) / 2) * SLOT;
    });
    const idx = want.map((_, i) => i).sort((a, b) => want[a] - want[b]);
    let floor = -Infinity;
    for (const i of idx) { want[i] = Math.max(want[i], floor); floor = want[i] + BOX_H + 14; }
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
    const from = [e.upper, e.lower].filter(Boolean).filter((k) => y.has(k)).map((k) => y.get(k));
    if (from.length) links.push({ col: colOf(m), from, to: y.get(slotOf(m)) });
  }

  // Matches whose winner qualifies out of this bracket get a slot to the
  // right saying so, which is what a play-in is for and what Liquipedia
  // draws there.
  const quals = matches
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
  if (top < TOP) {
    const shift = TOP - top;
    for (const [k, v] of y) y.set(k, v + shift);
    for (const l of links) { l.to += shift; l.from = l.from.map((v) => v + shift); }
    for (const q of quals) q.y += shift;
  }

  const height = Math.max(...[...y.values()].map((v) => v + BOX_H + CAP_H)) + 12;
  const lastCol = Math.max(...[...cols.values()].map((c) => c.col), ...quals.map((q) => q.col));
  const width = (lastCol + 1) * COL;
  return { cols: [...cols.values()], y, links, quals, height, width };
}

function side(team, score, state) {
  const attr = team ? ` data-team="${esc(team.toLowerCase())}" tabindex="0"` : "";
  return `<div class="side ${state}"${attr}>` +
    `<span class="team${team ? "" : " tbd"}">${teamMark(team)}${esc(team ?? "TBD")}</span>` +
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
      (who ? `${crest(who)}<span>${esc(who)}</span>` : `<span class="tbd">TBD</span>`) + `</div>`);
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
  return `<div class="scrollwrap"><span class="hint">scroll &rarr;</span>` +
    `<div class="scroll"><div class="bk" style="height:${L.height}px;width:${L.width}px">${parts.join("")}</div></div></div>`;
};

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
const stateOf = (e, now = Date.now()) => {
  if (!Number.isFinite(startMs(e))) return "tbd";
  if (now > endMs(e)) return "past";
  if (now >= startMs(e)) return "running";
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

  const years = all.map(([y, evs]) => {
    // A season with something live or upcoming in it still gets its own class,
    // which colours the label. The dot that used to sit after the year is
    // gone: the event tabs underneath already say "On now" against the event
    // it belongs to, in words, and a mark on the year said the same thing one
    // level too far away to be useful.
    const live = evs.some((e) => stateOf(e) === "running");
    const soon = evs.some((e) => stateOf(e) === "future");
    return `<button class="yr${y === year ? " on" : ""}${live ? " islive" : soon ? " isnext" : ""}" ` +
      `data-year="${esc(y)}" aria-pressed="${y === year ? "true" : "false"}">${esc(y)}</button>`;
  }).join("");

  const evs = (all.find(([y]) => y === year) ?? [null, []])[1];
  const tabs = evs.map((e) => {
    const st = stateOf(e);
    const cls = st === "running" ? " islive" : st === "future" ? " isnext" : "";
    const day = (d) => d ? new Date(`${d}T12:00:00Z`).toLocaleDateString([], { day: "numeric", month: "short" }) : "";
    const span = e.starts && e.ends
      ? (e.starts === e.ends ? day(e.starts) : `${new Date(`${e.starts}T12:00:00Z`).getUTCDate()}–${day(e.ends)}`)
      : "dates TBC";
    const label = st === "running" ? "On now" : st === "future" ? `${span} &middot; upcoming` : `${span} &middot; ${esc(cityOf(e) ?? "")}`;
    // "RLCS 2026" is dropped: the season is the row above and the page is
    // nothing but RLCS events.
    const name = String(e.name ?? e.slug).replace(/^RLCS\s+\d{4}\s*/, "");
    return `<button class="ev${cls}" data-slug="${esc(e.slug)}" aria-current="${e.slug === current ? "true" : "false"}">` +
      `<b>${esc(name)}</b><i>${label}</i></button>`;
  }).join("");

  return `<div class="years" role="group" aria-label="Season">${years}</div>` +
    `<div class="evs" role="group" aria-label="Events this season">${tabs}</div>`;
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

// The grand final: the last played match of the last bracket on the page.
function finalOf(ev) {
  const brackets = ev.stages.flatMap((s) => s.brackets);
  const last = brackets[brackets.length - 1];
  if (!last) return null;
  const played = last.matches.filter((m) => m.finished && m.scores[0] !== null && m.scores[1] !== null);
  return played.sort((a, b) => a.round - b.round || a.position - b.position).pop() ?? null;
}

// The schedule column, for the event on screen.
//
// Drawn from the same parsed matches as the bracket beside it, so the two can
// never disagree. Repainted on its own slow timer as well as on every render:
// "in 4 min" goes stale between polls even when the feed has not changed.
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
setInterval(paintSchedule, 15e3);

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
      sections.push({ name, stage: stageFor(name), format: stage.format ?? null, draw: () => bracketEl(b) });
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
  for (const el of document.querySelectorAll("[data-mi]")) {
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
addEventListener("resize", () => { fitBrackets(); markScrollable(); if (cardFor) place(cardFor); });
addEventListener("scroll", () => { if (cardFor) place(cardFor); }, { passive: true });

document.getElementById("rail").addEventListener("click", (e) => {
  const b = e.target.closest(".ev");
  if (b) { held = null; render(b.dataset.slug); scrollTo({ top: 0, behavior: "smooth" }); return; }
  // Picking a season opens its most recent event, which is the one a reader
  // means by "2025" - not the oldest one that happens to sort first.
  const y = e.target.closest(".yr");
  if (y) {
    const first = EVENTS.filter((x) => String(x.starts ?? "").startsWith(y.dataset.year))[0];
    if (first) { held = null; render(first.slug); }
  }
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
  const scrolls = [...document.querySelectorAll(".scrollwrap .scroll")].map((el) => el.scrollLeft);
  const y = window.scrollY;

  render(CURRENT);

  document.querySelectorAll(".scrollwrap .scroll").forEach((el, i) => {
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

import { crest, assignHues } from "/crest.mjs";
import { standings, pairGroups } from "/standings.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const timeOf = (iso) => iso ? new Date(iso).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "TBD";
const dayOf = (iso) => iso ? new Date(iso).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" }) : null;
const shortDay = (d) => d ? new Date(`${d}T12:00:00Z`).toLocaleDateString([], { day: "numeric", month: "short" }) : "";
const clockOf = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

const BOX_W = 200, GUTTER = 44, ROW_H = 26, BOX_H = ROW_H * 2 + 2;
const SLOT = BOX_H + 30, HEAD_H = 26, TOP = HEAD_H + 10, COL = BOX_W + GUTTER;
const LIVE_FOR = 2 * 3600e3;   // a started match counts as live for this long

// The R<n>M<n> key, which is how the edge list names a match.
const slotOf = (m) => `R${m.round}M${m.position}`;

const isLive = (m) => m.startsAt && !m.finished &&
  Date.now() >= Date.parse(m.startsAt) && Date.now() - Date.parse(m.startsAt) < LIVE_FOR;

// Every match of the event being shown, flat and indexed, so a box can carry
// a number rather than its whole contents in data attributes.
let MATCHES = [];
let CURRENT = null;      // slug of the event on screen
let SCHED = [];          // the stage schedule, from the page's Format section
// Which stage a match belongs to, set while a section is being rendered, so
// an undated match can still say when its stage runs.
let STAGE = null;

// "18-20 Sept", or "15 Sept" for a single day.
function windowOf(st) {
  if (!st?.from) return null;
  const d = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString([], { day: "numeric", month: "short" });
  return st.to && st.to !== st.from ? `${new Date(`${st.from}T12:00:00Z`).getUTCDate()}–${d(st.to)}` : d(st.from);
}

// Match a section to its line in the Format section. The names line up
// ("Play-In", "Group Stage", "Playoffs"); a contains-either test covers
// "Swiss Stage" against a section called "Swiss stage".
function stageFor(name) {
  const n = String(name).toLowerCase();
  return SCHED.find((x) => x.name.toLowerCase() === n)
    ?? SCHED.find((x) => n.includes(x.name.toLowerCase()) || x.name.toLowerCase().includes(n))
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

  const height = Math.max(...[...y.values()].map((v) => v + BOX_H + CAP_H)) + 12;
  const lastCol = Math.max(...[...cols.values()].map((c) => c.col), ...quals.map((q) => q.col));
  const width = (lastCol + 1) * COL;
  return { cols: [...cols.values()], y, links, quals, height, width };
}

function side(team, score, state) {
  const attr = team ? ` data-team="${esc(team.toLowerCase())}" tabindex="0"` : "";
  return `<div class="side ${state}"${attr}>` +
    `<span class="team${team ? "" : " tbd"}">${crest(team)}${esc(team ?? "TBD")}</span>` +
    `<span class="sc">${score === null ? "&middot;" : score}</span></div>`;
}

function matchBox(m, x, y) {
  const played = !m.upcoming;
  const [a, b] = m.scores;
  const st = (s, o) => !played || s === null || o === null ? "" : s > o ? "won" : "lost";
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
    : played ? ""
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
    const done = !q.m.upcoming && a !== null && b !== null;
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
    const [a, b] = m.scores, played = !m.upcoming;
    const wa = played && a !== null && b !== null && a > b, wb = played && a !== null && b !== null && b > a;
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

const doc = await (await fetch("/data/bracket.json?v=" + Date.now())).json();

// Newest first. An event with no dates yet sorts to the front rather than
// vanishing off the end.
const EVENTS = [...doc.events].sort((a, b) => String(b.starts ?? "9999").localeCompare(String(a.starts ?? "9999")));

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
    // A season with something live or upcoming in it is worth marking, so
    // the reader can see where the action is without opening it.
    const live = evs.some((e) => stateOf(e) === "running");
    const soon = evs.some((e) => stateOf(e) === "future");
    return `<button class="yr${y === year ? " on" : ""}${live ? " islive" : soon ? " isnext" : ""}" ` +
      `data-year="${esc(y)}" aria-pressed="${y === year ? "true" : "false"}">${esc(y)}` +
      `${live ? `<i class="pip" title="Event on now"></i>` : soon ? `<i class="pip soon" title="Event still to come"></i>` : ""}</button>`;
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

// ---- the hero, and each event's own banner -------------------------------
//
// The first thing on the page is the LAN that is on now, or the next one.
// That is the question someone opens this page with, and it stays true while
// they browse a 2024 bracket underneath it.

let tick = null;
const DOT = '<span class="dot"></span>';

// The event the hero is about: whatever is running, else the soonest one
// still to come, else nothing.
function heroEvent() {
  const running = EVENTS.filter((e) => stateOf(e) === "running");
  if (running.length) return running[0];
  return EVENTS.filter((e) => stateOf(e) === "future").sort((a, b) => startMs(a) - startMs(b))[0] ?? null;
}

// Every match of an event, whether or not it is the one being shown.
const allOf = (ev) => ev.stages.flatMap((s) =>
  [...s.brackets.flatMap((b) => b.matches), ...s.matchlists.flatMap((l) => l.matches)]);

function heroEl(self) {
  const ev = heroEvent();
  if (!ev) return "";
  const matches = allOf(ev);
  const live = matches.filter(isLive);
  const next = matches
    .filter((m) => m.startsAt && m.upcoming && Date.parse(m.startsAt) > Date.now())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];

  const running = stateOf(ev) === "running";
  const target = live.length ? endMs(ev) : next ? Date.parse(next.startsAt) : running ? endMs(ev) : startMs(ev);
  const lab = live.length ? "Ends in" : next ? (running ? "Next match in" : "First match in") : running ? "Ends in" : "Starts in";

  // Two courts can run at once at a LAN, so both get a line rather than one
  // fixture and a "+1 more" that names neither team.
  const liveLine = (m) =>
    `<span class="fx live">${crest(m.teams[0])}${esc(m.teams[0] ?? "TBD")}` +
    `<b>${m.scores[0] ?? 0}</b><i>&ndash;</i><b>${m.scores[1] ?? 0}</b>` +
    `${crest(m.teams[1])}${esc(m.teams[1] ?? "TBD")}</span>`;
  const fixture = live.length
    ? live.slice(0, 2).map(liveLine).join("") +
      (live.length > 2 ? `<span class="fx"><u>+${live.length - 2} more on now</u></span>` : "")
    : next
      ? `<span class="fx">${crest(next.teams[0])}${esc(next.teams[0] ?? "TBD")}<i>vs</i>` +
        `${crest(next.teams[1])}${esc(next.teams[1] ?? "TBD")}<u>${esc(next.label ?? "")}</u></span>`
      : "";

  const where = [cityOf(ev), ev.venue].filter(Boolean).join(", ");
  const dates = ev.starts && ev.ends ? `${shortDay(ev.starts)} &ndash; ${shortDay(ev.ends)}` : "";

  return `<section class="hero${live.length ? " onair" : ""}" aria-label="Current event">
    <div class="hl">
      <span class="pill">${live.length ? `${DOT}Live now` : running ? `${DOT}Under way` : self ? "Next up" : "Next LAN"}</span>
      ${self ? "" : `<h2>${esc(ev.name ?? ev.slug)}</h2>`}
      <p>${esc(where)}${dates ? ` &middot; ${dates}` : ""}${ev.teamCount ? ` &middot; ${ev.teamCount} teams` : ""}</p>
    </div>
    <div class="hr">
      <span class="top"><span class="lab">${lab}</span>
        <span class="clock" id="clock" data-target="${target}"></span></span>
      ${fixture}
    </div>
    ${self ? "" : `<button class="go" data-slug="${esc(ev.slug)}">Open bracket</button>`}
  </section>`;
}

// The banner for the event actually on screen. A finished LAN gets its
// result; a running one gets its progress. The hero above already carries
// the countdown, so this never repeats it.
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

  // The event on screen IS the one the hero is about: show the hero card
  // here, under its own masthead, rather than the same thing twice.
  if (heroEvent()?.slug === ev.slug) {
    const progress = ev.counts.played
      ? `<section class="progress"><span class="lab">Progress</span>` +
        `<span class="bar"><span style="width:${Math.round((ev.counts.played / Math.max(1, ev.counts.matches)) * 100)}%"></span></span>` +
        `<span class="note">${ev.counts.played} of ${ev.counts.matches} matches played</span></section>`
      : "";
    return heroEl(true) + progress;
  }
  const when = ev.starts ? `${shortDay(ev.starts)} &ndash; ${shortDay(ev.ends)}` : "dates to be confirmed";
  return `<section class="progress"><span class="lab">${st === "running" ? "Under way" : "Upcoming"}</span>` +
    `<span class="note">${when}</span></section>`;
}

// The grand final: the last played match of the last bracket on the page.
function finalOf(ev) {
  const brackets = ev.stages.flatMap((s) => s.brackets);
  const last = brackets[brackets.length - 1];
  if (!last) return null;
  const played = last.matches.filter((m) => !m.upcoming && m.scores[0] !== null && m.scores[1] !== null);
  return played.sort((a, b) => a.round - b.round || a.position - b.position).pop() ?? null;
}

function paintClock() {
  const el = document.getElementById("clock");
  if (!el) return;
  let left = Number(el.dataset.target) - Date.now();
  if (left <= 0) { el.textContent = "now"; return; }
  const d = Math.floor(left / 86400e3); left -= d * 86400e3;
  const h = Math.floor(left / 3600e3); left -= h * 3600e3;
  const m = Math.floor(left / 60e3);
  const s = Math.floor((left - m * 60e3) / 1000);
  // Seconds only inside the last hour: a six-day counter ticking every second
  // is noise, and the last hour is when it is worth watching.
  const parts = d ? [[d, "d"], [h, "h"], [m, "m"]] : h ? [[h, "h"], [m, "m"], [s, "s"]] : [[m, "m"], [s, "s"]];
  el.innerHTML = parts.map(([n, u]) => `${n}<u>${u}</u>`).join("");
}

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
  const played = !m.upcoming && a !== null && b !== null;
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
  return `<div class="day">${head}</div>` +
    `<div class="fx">${sd(m.teams[0], a, b)}<span class="mid${played || live ? "" : " pending"}">${mid}</span>${sd(m.teams[1], b, a)}</div>` +
    (note ? `<div class="note">${note}</div>` : "") +
    (links.length ? `<div class="foot">${links.join("")}</div>` : "");
}

let cardFor = null;
let cardTimer = null;

// Leaving the box does not close the card straight away, and entering the
// card cancels the close. Without this the buttons are unreachable: the
// pointer has to cross the gap between the box and the card, and the card
// vanished the moment it left the box.
card.addEventListener("mouseenter", () => clearTimeout(cardTimer));
card.addEventListener("mouseleave", () => hideCard());
function closeSoon() {
  clearTimeout(cardTimer);
  cardTimer = setTimeout(() => {
    // Ask where the pointer actually is rather than trusting that the card's
    // own mouseenter arrived. Moving from the box to a button crosses a
    // boundary the browser does not always report in order, and getting it
    // wrong means the buttons cannot be clicked at all - which is the whole
    // reason the card has a delay.
    if (card.matches(":hover")) { closeSoon(); return; }
    hideCard();
  }, 240);
}

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

// A bracket's name, from what it contains rather than its position in the
// list. "Bracket 1" told a reader nothing, and the match count beside it was
// a number nobody needs next to a diagram that shows every match.
function bracketName(b, i, all) {
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
  document.getElementById("hero").innerHTML = heroEvent()?.slug === ev.slug ? "" : heroEl(false);
  document.getElementById("rail").innerHTML = railEl(ev.slug);
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
        draw: () => {
          const paired = pairGroups(stage.tables, stage.matchlists);
          return `<div class="groups">${paired.map(({ list, table }) => groupEl(list, table)).join("")}</div>`;
        },
      });
    }
    stage.brackets.forEach((b, i) => {
      const name = bracketName(b, i, stage.brackets);
      sections.push({ name, stage: stageFor(name), draw: () => bracketEl(b) });
    });
  }
  sections.sort((a, b) => (a.stage?.from ?? "9999").localeCompare(b.stage?.from ?? "9999"));

  const out = [];
  for (const sec of sections) {
    // Set before drawing: an undated match reads its stage window from here.
    STAGE = sec.stage;
    const win = windowOf(sec.stage);
    out.push(`<h2 class="stage">${esc(sec.name)}${win ? `<span>${win}</span>` : ""}</h2>`);
    out.push(sec.draw());
  }
  STAGE = null;
  document.getElementById("out").innerHTML = out.join("");

  hideCard();
  wire();
  paintClock();
  clearInterval(tick);
  tick = setInterval(paintClock, 1000);
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
  for (const el of document.querySelectorAll("[data-mi]")) {
    el.addEventListener("mouseenter", () => showCard(el));
    el.addEventListener("focus", () => showCard(el));
    el.addEventListener("mouseleave", closeSoon);
    el.addEventListener("blur", (e) => { if (!card.contains(e.relatedTarget)) closeSoon(); });
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      showCard(el);
      const first = card.querySelector("a[href]");
      if (!first) return;
      e.preventDefault();
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

// A lane whose bracket is wider than the screen gets a fade and a "scroll"
// note, removed once it is scrolled to the end. The board is mobile-first and
// this page was not: at 375px the second column was cut with nothing saying so.
function markScrollable() {
  for (const wrap of document.querySelectorAll(".scrollwrap")) {
    const sc = wrap.querySelector(".scroll");
    if (!sc) continue;
    const update = () => wrap.classList.toggle("more", sc.scrollWidth - sc.clientWidth - sc.scrollLeft > 8);
    update();
    sc.addEventListener("scroll", update, { passive: true });
  }
}
addEventListener("resize", () => { markScrollable(); if (cardFor) place(cardFor); });
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
// The hero's own button, for when the reader is looking at a 2024 bracket and
// wants the one that is actually on.
document.getElementById("hero").addEventListener("click", (e) => {
  const b = e.target.closest(".go");
  if (b) { held = null; render(b.dataset.slug); }
});
// Anywhere else clears a held trace, so it never gets stuck on.
document.addEventListener("click", (e) => {
  if (!e.target.closest(".side[data-team]") && held) { held = null; trace(null); }
});
addEventListener("hashchange", () => render(location.hash.slice(1)));

// The board lives at the site root, which this preview server does not serve
// - it serves this folder and nothing else, so those links 404 locally and
// only work once the page is moved into web/. Point them at the deployed site
// while previewing, so they can actually be clicked and checked.
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
if (LOCAL) {
  for (const a of document.querySelectorAll("#nav a[data-to], footer .links a")) {
    a.href = "https://198x.online" + (a.dataset.to ?? a.getAttribute("href"));
    a.target = "_blank";
    a.rel = "noopener";
  }
}

// The footer's copyright year, the way status.js does it.
document.getElementById("yr").textContent = String(new Date().getFullYear());

render(location.hash.slice(1) || defaultEvent().slug);

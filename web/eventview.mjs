// The event as a phone sees it: a header, a schedule, a prize pool.
//
// A bracket is a picture, and a picture does not survive a 335px screen. The
// desktop page keeps its diagram and its schedule column; this is the same
// event told the way a phone can actually read it - what is on, in date order,
// with the time big enough to read at arm's length, and what the thing is
// worth.
//
// Everything here comes from the same parsed event the diagram is drawn from,
// so the two can never disagree, and it says TBD wherever Liquipedia has not
// published something rather than filling the gap.
// Relative, not "/crest.mjs": this module sits at the site root beside them, so
// both resolve to the same URL in the browser, and only the relative form loads
// under node, where the tests import this file directly.
import { crest, hasLogo, teamSlug, teamName } from "./crest.mjs?v=3d51b913";
import { flagSVG } from "./flags.mjs?v=d67b29cc";
import { matchesOf, whenWords, zoneLabel, ordinal, isLive } from "./fixtures.mjs?v=5b6fa514";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// A short name for a card, where a full one would wrap under a crest. The
// overrides are the ones people actually say; the fallback is the first word,
// capped, because "Spacestation Gaming" under a 34px tile is four lines.
const SHORT = {
  "karmine-corp": "KC", "spacestation-gaming": "SSG", "team-falcons": "FLCN",
  "gentle-mates": "M8", "ninjas-in-pyjamas": "NIP", "twisted-minds": "TWIS",
  "shopify-rebellion": "SR", "manchester-city-esports": "MCI", "man-city-esports": "MCI",
  "virtus-pro": "VP", "virtuspro": "VP", "team-vitality": "VIT", "vitality": "VIT",
  "fut-esports": "FUT", "furia": "FUR", "furia-esports": "FUR", "bigodes": "BIGO",
  "five-fears": "5F", "mate-y-tapa": "MYT", "r8-esports": "R8", "wildcard": "WC",
  "team-bds": "BDS", "geng-mobil1-racing": "GENG", "shopify": "SR",
};
export function shortName(name) {
  if (!name) return "TBD";
  const slug = teamSlug(name);
  if (SHORT[slug]) return SHORT[slug];
  const word = String(name).split(/\s+/)[0];
  return word.length > 6 ? word.slice(0, 5).toUpperCase() : word.toUpperCase();
}

const money = (usd) => {
  if (!Number.isFinite(usd)) return "";
  if (usd >= 1e6) return "$" + (usd / 1e6).toFixed(usd % 1e6 ? 1 : 0) + "M";
  if (usd >= 1000) return "$" + (usd / 1000).toFixed(usd % 1000 ? 1 : 0) + "K";
  return "$" + usd;
};

/**
 * "15 - 20 September 2026", or one date for a single day.
 *
 * formatRange, in UTC, for the same reasons as spanWords: a day number glued
 * to a formatted end date read "15 – September 20, 2026" in en-US, and a local
 * zone moved the end a day late east of UTC+12.
 */
export function dateRange(ev, locale = undefined) {
  if (!ev?.starts) return "";
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const at = (iso) => new Date(iso + "T12:00:00Z");
  if (!ev.ends || ev.ends === ev.starts) return fmt.format(at(ev.starts));
  return fmt.formatRange(at(ev.starts), at(ev.ends));
}

/** The header block: what the event is, when, what it is worth, and where. */
export function headerHTML(ev) {
  if (!ev) return "";
  // The prize and the place. The team count came out: it is on the bracket
  // underneath, one row per team, and a number for it here was a fact stated
  // twice.
  const flag = flagSVG(ev.countryCode, ev.country ?? "");
  const chips = [
    ev.prizePool ? `<span class="ech">$${esc(ev.prizePool)}</span>` : "",
    ev.city
      ? `<span class="ech">${flag}${esc(ev.city)}</span>`
      : "",
  ].filter(Boolean).join("");
  return `<div class="ehead">` +
    `<h1 class="etitle">${esc(ev.name ?? ev.slug)}</h1>` +
    `<p class="edates">${esc(dateRange(ev))}</p>` +
    (chips ? `<div class="echips">${chips}</div>` : "") +
    `</div>`;
}

// ---- schedule ---------------------------------------------------------------

const dayKey = (ms) => {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Every match of an event, split into what is still to come and what is done.
 *
 * Undated matches stay in "upcoming" and sort to the end of the day their stage
 * runs, because a round with no published time has not been played yet and
 * hiding it would be a worse lie than showing it without a clock.
 */
export function scheduleOf(ev, nowMs) {
  const all = matchesOf(ev);
  const at = (m) => Date.parse(m.startsAt ?? "");
  const upcoming = [];
  const finished = [];
  for (const m of all) {
    if (m.finished) finished.push(m);
    else upcoming.push(m);
  }
  upcoming.sort((a, b) => {
    const x = at(a), y = at(b);
    if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
    if (Number.isFinite(x)) return -1;
    if (Number.isFinite(y)) return 1;
    return String(a.window?.from ?? "9999").localeCompare(String(b.window?.from ?? "9999"));
  });
  finished.sort((a, b) => (at(b) || 0) - (at(a) || 0));
  return { upcoming, finished };
}

/** Group a list of matches under the day they are played, in reading order. */
export function byDay(list, nowMs) {
  const days = [];
  for (const m of list) {
    const at = Date.parse(m.startsAt ?? "");
    const key = Number.isFinite(at) ? dayKey(at) : (m.window?.from ?? "tbd");
    let day = days.find((d) => d.key === key);
    if (!day) days.push((day = { key, matches: [] }));
    day.matches.push(m);
  }
  return days;
};

const side = (m, i) => {
  const name = m.teams?.[i] ?? null;
  const seed = Boolean(m.seeds?.[i]);
  const teamGame = !m.format || m.format === "3v3";
  // A seed is a route into the match ("Group A #1"), not a team, so it gets the
  // placeholder tile and its own wording rather than a crest and a short code.
  if (seed) {
    const [group, place] = String(name).split("#");
    return `<div class="eside seed"><span class="etbd" aria-hidden="true"></span>` +
      `<span class="ename">${esc(group.trim())}</span>` +
      (place ? `<span class="eseed">#${esc(place.trim())}</span>` : "") + `</div>`;
  }
  if (!name) {
    return `<div class="eside seed"><span class="etbd" aria-hidden="true"></span>` +
      `<span class="ename">TBD</span></div>`;
  }
  const mark = teamGame || hasLogo(name) ? crest(name, "big") : "";
  // The side disciplines enter under a short code, so the code is resolved to
  // the org before anything is drawn. A 3v3 card is still shortened, because a
  // full name under a 34px tile is four lines.
  const full = teamName(name);
  return `<div class="eside"><span class="emark">${mark}</span>` +
    `<span class="ename">${esc(teamGame ? shortName(full) : full)}</span></div>`;
};

const middle = (m, nowMs, zone) => {
  const [a, b] = m.scores ?? [null, null];
  if (m.finished && a !== null && b !== null) {
    return `<div class="emid done"><span class="escore">${esc(a)}<i>&ndash;</i>${esc(b)}</span>` +
      `<span class="ezone">Final</span></div>`;
  }
  if (isLive(m, nowMs)) {
    return `<div class="emid live"><span class="escore">${esc(a ?? 0)}<i>&ndash;</i>${esc(b ?? 0)}</span>` +
      `<span class="ezone">Live</span></div>`;
  }
  const words = whenWords(m.startsAt, nowMs);
  if (!words) return `<div class="emid"><span class="etime tbd">Time TBD</span></div>`;
  // The clock alone at this size, with the zone under it: the day is already
  // the heading this card sits under.
  const clock = words.replace(/^\d+(st|nd|rd|th)\s+/, "");
  return `<div class="emid"><span class="etime">${esc(clock)}</span>` +
    (zone ? `<span class="ezone">${esc(zone)}</span>` : "") + `</div>`;
};

const cardHTML = (m, nowMs, zone) =>
  `<li class="ecard${isLive(m, nowMs) ? " onair" : ""}" data-mi="${m._i ?? ""}" tabindex="0">` +
  `<div class="ecap">${esc(m.label ?? m.stage ?? "Match")}` +
  (m.format && m.format !== "3v3" ? `<span class="efmt">${esc(m.format)}</span>` : "") +
  `</div>` +
  `<div class="erow">${side(m, 0)}${middle(m, nowMs, zone)}${side(m, 1)}</div></li>`;

/** One day's heading: the weekday and the date, beside its matches. */
const dayHTML = (day, nowMs, zone) => {
  const known = day.key !== "tbd";
  const d = known ? new Date(day.key + "T12:00:00") : null;
  const head = known
    ? `<span class="edow">${d.toLocaleDateString([], { weekday: "short" })}</span>` +
      `<span class="edate">${d.getDate()}</span>`
    : `<span class="edow">Date</span><span class="edate tbd">TBD</span>`;
  return `<section class="eday"><div class="edaynum">${head}</div>` +
    `<ul class="ecards">${day.matches.map((m) => cardHTML(m, nowMs, zone)).join("")}</ul></section>`;
};

/** The schedule pane. `tab` is "upcoming" or "finished". */
export function scheduleHTML(ev, nowMs, tab = "upcoming") {
  const { upcoming, finished } = scheduleOf(ev, nowMs);
  const list = tab === "finished" ? finished : upcoming;
  const zone = zoneLabel(nowMs);
  const toggle = `<div class="etabs2" role="group" aria-label="Which matches">` +
    `<button data-when="upcoming" aria-pressed="${tab !== "finished"}">Upcoming</button>` +
    `<button data-when="finished" aria-pressed="${tab === "finished"}">Completed</button></div>`;
  if (!list.length) {
    const empty = tab === "finished" ? "No match has finished yet." : "Nothing left to play.";
    return toggle + `<p class="eempty">${empty}</p>`;
  }
  const days = byDay(list, nowMs);
  let month = "";
  const out = [];
  for (const day of days) {
    const label = day.key === "tbd"
      ? "Date to be confirmed"
      : new Date(day.key + "T12:00:00").toLocaleDateString([], { month: "long", year: "numeric" });
    if (label !== month) { out.push(`<h3 class="emonth">${esc(label)}</h3>`); month = label; }
    out.push(dayHTML(day, nowMs, zone));
  }
  return toggle + out.join("");
}

// ---- who is here ------------------------------------------------------------

/**
 * Every team in the event, and whether they are still in it.
 *
 * Out means eliminated: they appear in a finished match and lost it, and no
 * unfinished match still names them. That is derivable from the bracket alone,
 * which is the point - nothing here needs a second source.
 */
export function teamsOf(ev) {
  const all = matchesOf(ev).filter((m) => !m.format || m.format === "3v3");
  const seen = new Map();
  for (const m of all) {
    (m.teams ?? []).forEach((name, i) => {
      if (!name || m.seeds?.[i]) return;
      if (!seen.has(name)) seen.set(name, { name, playing: false, lost: false });
      const t = seen.get(name);
      if (!m.finished) { t.playing = true; return; }
      const [a, b] = m.scores ?? [null, null];
      if (a === null || b === null) return;
      const won = i === 0 ? a > b : b > a;
      if (!won) t.lost = true;
    });
  }
  const list = [...seen.values()].map((t) => ({ name: t.name, out: t.lost && !t.playing }));
  return list.sort((x, y) => Number(x.out) - Number(y.out) || x.name.localeCompare(y.name));
}

export function teamsHTML(ev) {
  const list = teamsOf(ev);
  if (!list.length) return `<p class="eempty">The teams are not drawn yet.</p>`;
  const cells = list.map((t) =>
    `<li class="eteam${t.out ? " out" : ""}">${crest(t.name, "big")}` +
    `<span class="etname">${esc(t.name)}</span>` +
    (t.out ? `<span class="eoutt">Out</span>` : "") + `</li>`).join("");
  // No count line above this. The crests say who is here and the faded ones
  // say who is out, so a tally of the same two facts was stating them twice.
  return `<h3 class="eph">Teams</h3><ul class="eteams">${cells}</ul>`;
}

// ---- prize pool -------------------------------------------------------------

/**
 * The prize pool pane: one table per discipline.
 *
 * The places used to run 1 to 20 and then start again at 1, because every
 * stage's prizes were flattened into a single list and the 3v3 table ran
 * straight into the 2v2 one. A stage carries its `format`, so that is what
 * groups them, and each group is sorted by the first number in its place
 * ("3-4" -> 3) rather than by the order the wikitext happened to list them.
 *
 * Placements are only filled in where the event has actually been decided, and
 * this page does not know that until the bracket does, so every participant
 * cell reads TBD until a winner exists. A table that guessed would be inventing
 * a result.
 */
const DISCIPLINES = ["3v3", "2v2", "1v1"];

const placeNo = (p) => {
  const n = Number(String(p.place).split("-")[0]);
  return Number.isFinite(n) ? n : Infinity;
};

const prizeTable = (prizes) => {
  const rows = [...prizes].sort((a, b) => placeNo(a) - placeNo(b)).map((p) => {
    const first = placeNo(p);
    const cls = first === 1 ? " gold" : first === 2 ? " silver" : first === 3 ? " bronze" : "";
    // A non-breaking hyphen: "3-4" is one placement and wrapping it onto two
    // lines read as two.
    const place = String(p.place).replace(/-/g, "‑");
    return `<tr><td class="eplace${cls}">${esc(place)}.</td>` +
      `<td class="ewho"><span class="etbd" aria-hidden="true"></span>TBD</td>` +
      `<td class="emoney">${esc(money(p.usd))}</td></tr>`;
  }).join("");
  return `<table class="eprize"><thead><tr><th>#</th><th>Participant</th><th>Prize money</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`;
};

export function prizesHTML(ev) {
  // Grouped by the discipline the stage is played in, in the order the event
  // runs them. A discipline Liquipedia publishes no pool for gets no section:
  // an empty table would be a claim that there is no prize money, which is a
  // different thing from not knowing.
  const groups = new Map();
  for (const st of ev?.stages ?? []) {
    const prizes = st.prizes ?? [];
    if (!prizes.length) continue;
    const key = st.format ?? "3v3";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(...prizes);
  }
  if (!groups.size) return `<p class="eempty">No prize pool published for this event.</p>`;

  const order = [...groups.keys()].sort((a, b) => {
    const x = DISCIPLINES.indexOf(a), y = DISCIPLINES.indexOf(b);
    return (x < 0 ? DISCIPLINES.length : x) - (y < 0 ? DISCIPLINES.length : y) || a.localeCompare(b);
  });

  // One discipline needs no label saying which one it is.
  const label = order.length > 1;
  return `<h3 class="eph">Prize pool</h3>` + order.map((k) =>
    (label ? `<h4 class="esub">${esc(k)}</h4>` : "") + prizeTable(groups.get(k))).join("");
}

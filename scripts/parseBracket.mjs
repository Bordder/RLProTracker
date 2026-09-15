// Wikitext -> bracket JSON. Pure: no network, no filesystem, no clock.
//
// LOCAL ONLY for now. This whole folder is gitignored; files move into
// scripts/ and web/ in a deliberate commit when the page is wanted live.
//
// Shape, verified against live fixtures on 11 September 2026:
//
//   {{Bracket|Bracket/8-2Q-U-4L2D-2Q|id=pwvMCvdp2Q
//   |R1M1={{Match
//       |opponent1={{TeamOpponent|m8|score=3}}
//       |opponent2={{TeamOpponent|whatever.|score=0}}
//       |finished=t
//       |date=November 15, 2025 - 18:45 {{Abbr/CET}}
//   }}
//   }}
//
// Two rules this file exists to honour:
//
//   Round and position come from the R<n>M<n> KEY, never from the bracket
//   template name. Key names are stable; template names are not
//   (Bracket/8-2Q-U-4L2D-2Q vs Bracket/2-2-U-8L4DS vs Bracket/2-2-U-4L4DS).
//
//   An EMPTY score is "not played yet", not zero. On 11 September the Worlds
//   page carried 94 opponents and 94 score fields, every one of them empty.
//   Rendering those as 0-0 would show a completed 0-0 tournament.

// Split template arguments on top-level pipes only.
//
// A regex cannot do this: nesting runs three deep (Bracket -> Match ->
// TeamOpponent/Map) and an inner {{Abbr/CET}} sits inside a date value. Track
// brace and bracket depth and only break where depth is zero.
export function splitArgs(body) {
  const out = [];
  let depth = 0, buf = "";
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === "{{" || two === "[[") { depth++; buf += two; i++; continue; }
    if (two === "}}" || two === "]]") { depth--; buf += two; i++; continue; }
    if (body[i] === "|" && depth === 0) { out.push(buf); buf = ""; continue; }
    buf += body[i];
  }
  out.push(buf);
  return out;
}

// Find each {{Name ...}} at the top level of `text`, returning name and body.
export function findTemplates(text, name) {
  const found = [];
  // MediaWiki treats a template's first letter as case-insensitive, and the
  // Worlds page uses {{matchlist}} in lower case while every other page uses
  // {{Matchlist}}. Matching case-sensitively silently dropped the entire group
  // stage - four blocks, 24 matches - and the page still looked plausible,
  // which is the worst kind of parsing bug.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("\\{\\{" + escaped + "(?![A-Za-z0-9])", "gi");
  for (const match of text.matchAll(re)) {
    const start = match.index;
    let depth = 0, i = start;
    for (; i < text.length; i++) {
      if (text.slice(i, i + 2) === "{{") { depth++; i++; continue; }
      if (text.slice(i, i + 2) === "}}") { depth--; i++; if (depth === 0) { i++; break; } continue; }
    }
    found.push({ start, end: i, body: text.slice(start + 2, i - 2) });
  }
  // Drop templates nested inside an earlier hit, so a Match inside a Bracket
  // is not also returned as a top-level Match.
  return found.filter((t, idx) => !found.some((o, j) => j !== idx && o.start < t.start && o.end >= t.end));
}

// "k=v" pairs from a template body, plus the positional arguments before them.
export function templateArgs(body) {
  const parts = splitArgs(body);
  const positional = [];
  const named = {};
  parts.slice(1).forEach((p) => {
    const eq = p.indexOf("=");
    // A pipe inside a value is already handled; an "=" inside a nested
    // template is not a key separator, so only split before the first {{.
    const brace = p.indexOf("{{");
    if (eq === -1 || (brace !== -1 && brace < eq)) positional.push(p.trim());
    else named[p.slice(0, eq).trim()] = p.slice(eq + 1).trim();
  });
  return { name: parts[0].trim(), positional, named };
}

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
// Offsets for the zones Liquipedia actually uses on these pages. A date that
// cannot be parsed returns null rather than a guess: a wrong kickoff time is
// worse than none, and the page can fall back to "TBD".
const ZONES = { UTC: 0, GMT: 0, BST: 60, CET: 60, CEST: 120, EST: -300, EDT: -240, CST: -360, CDT: -300, PST: -480, PDT: -420, AEST: 600, KST: 540, JST: 540 };

// "November 15, 2025 - 18:45 {{Abbr/CET}}" -> ISO instant
export function parseDate(raw) {
  if (!raw) return null;
  const zone = raw.match(/Abbr\/([A-Z]{2,5})/)?.[1] ?? raw.match(/\b([A-Z]{2,5})\b\s*$/)?.[1];
  const m = raw.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month === -1) return null;
  const offset = ZONES[zone];
  if (offset === undefined) return null;
  const utc = Date.UTC(+m[3], month, +m[2], +m[4], +m[5]) - offset * 60e3;
  return new Date(utc).toISOString();
}

function parseOpponent(raw) {
  if (!raw) return { team: null, score: null };
  // 1v1 events name a PLAYER, not a team: the 2026 1v1 Worlds bracket is
  // {{SoloOpponent|Nwpo|score=}} throughout. Reading only TeamOpponent left
  // that whole bracket as TBD against TBD while the draw was actually made.
  const t = findTemplates(raw, "TeamOpponent")[0] ?? findTemplates(raw, "SoloOpponent")[0];
  if (!t) return { team: null, score: null };
  const { positional, named } = templateArgs(t.body);
  const score = (named.score ?? "").trim();
  return {
    team: positional[0] || null,
    // Empty means unplayed. Only a real number becomes a number.
    score: score === "" ? null : Number.isFinite(+score) ? +score : null,
  };
}

export function parseMatch(body) {
  const { named } = templateArgs(body);
  const a = parseOpponent(named.opponent1);
  const b = parseOpponent(named.opponent2);
  const maps = Object.keys(named)
    .filter((k) => /^map\d+$/.test(k))
    .sort((x, y) => +x.slice(3) - +y.slice(3))
    .map((k) => {
      const { named: mn } = templateArgs(findTemplates(named[k], "Map")[0]?.body ?? "");
      return {
        name: (mn.map ?? "").trim() || null,
        score1: mn.score1 ? +mn.score1 : null,
        score2: mn.score2 ? +mn.score2 : null,
      };
    });
  const hasScore = a.score !== null || b.score !== null;
  // Three states, not two, because a Bo5 sitting at 2-1 is neither.
  //
  // Liquipedia fills the score in as each game is played and sets finished=
  // only when the series ends, so treating any score as a result declared
  // Virtus.pro the winner of a live 2-1 and qualified them out of the play-in
  // while the fourth game was being played. Measured across the ten cached
  // events on 15 September: 396 completed matches, every one of them
  // flagged, and the only two unflagged were the two being played. So the
  // flag is what decides a series, and a score without it means in progress.
  const finished = /^(t|true|1)$/i.test(named.finished ?? "");
  return {
    teams: [a.team, b.team],
    scores: [a.score, b.score],
    finished,
    live: hasScore && !finished,
    upcoming: !hasScore,
    startsAt: parseDate(named.date),
    maps: maps.length ? maps : null,
    blasttv: named.blasttv || null,
  };
}

// The round each slot belongs to, from the HTML comments in the wikitext.
//
// Liquipedia writes "<!-- Upper Bracket Quarterfinals -->" above the group of
// R<n>M<n> keys it applies to, and those labels are the whole structure of the
// page: they carry the real round names, and they separate the upper bracket
// from the lower one. Without them R1 looks like six unrelated matches, when
// it is actually four upper quarterfinals and two lower quarterfinals that
// Liquipedia draws as two separate blocks.
//
// Derived from the raw body rather than the parsed args, because templateArgs
// throws the comments away.
export function slotLabels(body) {
  const labels = {};
  let current = null;
  let depth = 0;

  // Only comments at the TOP level of the bracket are round labels. Liquipedia
  // also writes the map name as a comment INSIDE each {{Map}}, so a flat scan
  // picks up "Champions Field" and "Neo Tokyo" and labels whole rounds with
  // them - two rounds of the Boston Major came out named after a map before
  // this tracked depth.
  const re = /\{\{|\}\}|<!--\s*([\s\S]*?)\s*-->|\|\s*(R\d+M\d+)\s*=/g;
  for (const m of body.matchAll(re)) {
    const tok = m[0];
    if (tok === "{{") { depth++; continue; }
    if (tok === "}}") { depth = Math.max(0, depth - 1); continue; }
    if (depth !== 0) continue;
    if (m[1] !== undefined) current = m[1] || null;
    else if (m[2]) labels[m[2]] = current;
  }
  return labels;
}

// Upper, lower or neither, inferred from the label. Liquipedia renders these
// as separate blocks, so the section is a layout fact and not decoration.
export function sectionOf(label) {
  if (!label) return null;
  const l = label.toLowerCase();
  if (l.startsWith("upper")) return "upper";
  if (l.startsWith("lower")) return "lower";
  return "final";
}

// Every {{Bracket}} on a page, each match keyed by its R<n>M<n> slot.
export function parseBrackets(wikitext) {
  return findTemplates(wikitext, "Bracket").map((t) => {
    const { positional, named } = templateArgs(t.body);
    const labels = slotLabels(t.body);
    const matches = [];
    for (const [key, value] of Object.entries(named)) {
      const slot = key.match(/^R(\d+)M(\d+)$/);
      if (!slot) continue;
      const inner = findTemplates(value, "Match")[0];
      if (!inner) continue;
      const label = labels[key] ?? null;
      matches.push({ round: +slot[1], position: +slot[2], label, section: sectionOf(label), ...parseMatch(inner.body) });
    }
    matches.sort((x, y) => x.round - y.round || x.position - y.position);
    return {
      // id can carry a trailing comment on its own lines; keep the first token.
      id: (named.id ?? "").split(/\s/)[0] || null,
      template: positional[0] ?? null,
      rounds: matches.length ? Math.max(...matches.map((m) => m.round)) : 0,
      matches,
    };
  });
}

// {{Matchlist}} is the group stage: same Match parsing, flat rather than a tree.
export function parseMatchlists(wikitext) {
  return findTemplates(wikitext, "Matchlist").map((t) => {
    const { named } = templateArgs(t.body);
    const matches = Object.entries(named)
      .filter(([k]) => /^M\d+$/.test(k))
      .sort((a, b) => +a[0].slice(1) - +b[0].slice(1))
      .map(([k, v]) => {
        const inner = findTemplates(v, "Match")[0];
        // Liquipedia groups a matchlist into rounds with M<n>header=Round 1,
        // and prints those as sub-headings inside the group table.
        return inner ? { label: named[`${k}header`] ?? null, ...parseMatch(inner.body) } : null;
      })
      .filter(Boolean);
    return { id: (named.id ?? "").split(/\s/)[0] || null, title: named.title ?? null, matches };
  });
}

// The event's own description, from the infobox at the top of the page.
//
// Every LAN page carries one, with the same field names across seasons back to
// 2024: name, city, country, venue, sdate, edate, team_number, prizepool. That
// makes the event list self-describing - events.json only has to say which
// page to read, and the display name, dates and venue come from the page
// itself rather than being copied by hand into a config that then goes stale.
//
// Values carry wiki markup: venue is often "[https://... K.B Hallen Arena]" or
// "Copper Box Arena |venuelink=...". Strip to plain text.
export function parseInfobox(wikitext) {
  const start = wikitext.search(/\{\{\s*Infobox league/i);
  if (start < 0) return {};

  // Read only the infobox's own body: the first template, brace-matched.
  let depth = 0, end = start;
  for (let i = start; i < wikitext.length; i++) {
    if (wikitext.startsWith("{{", i)) { depth++; i++; continue; }
    if (wikitext.startsWith("}}", i)) { depth--; i++; if (!depth) { end = i + 1; break; } }
  }
  const { named } = templateArgs(wikitext.slice(start + 2, end - 2));

  const plain = (v) => {
    if (!v) return null;
    let t = String(v);
    // A field can carry the NEXT field after an unescaped pipe.
    t = t.split(/\|\w+\s*=/)[0];
    t = t.replace(/\[(?:https?:)?\/\/\S+\s+([^\]]+)\]/g, "$1");   // [url label] -> label
    t = t.replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1");        // [[page|label]] -> label
    t = t.replace(/'{2,}|<[^>]+>/g, "").replace(/\{\{[^}]*\}\}/g, "");
    return t.trim() || null;
  };
  const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "").trim()) ? v.trim() : null);

  // "RLCS 2026 - World Championship" reads better as "RLCS 2026 World
  // Championship"; the hyphen is a Liquipedia house style, not part of a name.
  const name = plain(named.name)?.replace(/\s+-\s+/, " ") ?? null;
  const country = plain(named.country);

  return {
    name,
    city: plain(named.city),
    // Some pages write a country code ("us") where others write "United
    // States". Two letters is a code, not a country.
    country: country && country.length === 2 ? country.toUpperCase() : country,
    venue: plain(named.venue),
    starts: date(named.sdate),
    ends: date(named.edate),
    teamCount: named.team_number ? Number(named.team_number) || null : null,
    // Where the event is broadcast. The per-match fields carry a display
    // name ("Rocket League"), not a channel; the infobox carries the actual
    // channel, and it is the same broadcast for every match on the page.
    twitch: plain(named.twitch),
    youtube: plain(named.youtube),
    // The field is prizepoolusd on every page checked back to 2024.
    prizePool: plain(named.prizepoolusd ?? named.prizepool),
  };
}

// The group tables.
//
// {{GroupTableLeague}} carries the FINISHING ORDER and what each place means
// - pbg1=up is "advances", down is "eliminated" - but no win/loss numbers:
// Liquipedia computes those from the matches when it renders. So does this,
// in standings.mjs. What the table is read for is the order and the outcome,
// which cannot be derived from results alone once tiebreakers are involved.
//
// Before a draw the rows are present with team=tbd, which is not an error:
// the Worlds groups were undrawn four days out.
export function parseGroupTables(wikitext) {
  return findTemplates(wikitext, "GroupTableLeague").map((t) => {
    const { named } = templateArgs(t.body);
    const rows = [];
    for (let i = 1; named[`team${i}`] !== undefined; i++) {
      const team = String(named[`team${i}`] ?? "").trim();
      rows.push({
        rank: i,
        team: team && team.toLowerCase() !== "tbd" ? team : null,
        // up = advances, down = eliminated, stay = neither, and a blank
        // means the group has not been played out yet.
        outcome: (named[`bg${i}`] || "").trim() || null,
        // What finishing in this place WILL mean, which is known before the
        // group is played and is what makes a live table worth reading.
        meansIfHere: (named[`pbg${i}`] || "").trim() || null,
      });
    }
    return { title: (named.title ?? "").trim() || null, rows };
  });
}

// The stage schedule, from the Format section.
//
// Liquipedia's MATCH blocks carry a date only once a stage is scheduled in
// detail: four days out, the Worlds play-in had every kickoff and the group
// stage and playoffs had none at all. The page still states when those
// stages run, in prose, as a bulleted line per stage: the stage name in bold
// followed by a dash and an italic date span ("September 18th-20th").
//
// That is enough to say "18-20 Sept" instead of "TBD" on a playoff match,
// and enough to put the stages in the order they are played rather than the
// order their templates happen to appear in the wikitext.
export function parseSchedule(wikitext, year) {
  const section = /===\s*Format\s*===([\s\S]*?)(?:\n===|$)/i.exec(wikitext);
  if (!section) return [];
  const yr = year ?? /\b(20\d\d)\b/.exec(wikitext)?.[1] ?? String(new Date().getUTCFullYear());

  const out = [];
  const line = /^\*\s*'''([^']+)'''\s*[-–]\s*''([^']+)''/gm;
  for (let m; (m = line.exec(section[1])); ) {
    const name = m[1].trim();
    const span = m[2].trim();
    // "September 15th", "September 18th-20th", "September 30th-October 2nd".
    const first = /([A-Z][a-z]+)\s+(\d{1,2})/.exec(span);
    if (!first) continue;
    const rest = span.slice(first.index + first[0].length);
    const second = /[-–]\s*(?:([A-Z][a-z]+)\s+)?(\d{1,2})/.exec(rest);
    const iso = (mon, day) => {
      const d = Date.parse(`${mon} ${day}, ${yr} 12:00:00 UTC`);
      return Number.isFinite(d) ? new Date(d).toISOString().slice(0, 10) : null;
    };
    const from = iso(first[1], first[2]);
    const to = second ? iso(second[1] ?? first[1], second[2]) : from;
    if (!from) continue;
    // "All matches are {{Bo|5}}" belongs to the stage bullet it sits under.
    const tail = section[1].slice(m.index + m[0].length).split(/\n\*'''/)[0];
    const bo = /\{\{Bo\|(\d+)\}\}/i.exec(tail);
    out.push({ name, from, to: to ?? from, bestOf: bo ? Number(bo[1]) : null });
  }
  return out;
}

export function parsePage(wikitext, meta = {}) {
  const brackets = parseBrackets(wikitext);
  const matchlists = parseMatchlists(wikitext);
  const tables = parseGroupTables(wikitext);
  const info = parseInfobox(wikitext);
  const all = [...brackets.flatMap((b) => b.matches), ...matchlists.flatMap((m) => m.matches)];
  return {
    ...meta,
    info,
    schedule: parseSchedule(wikitext, info.starts?.slice(0, 4)),
    brackets,
    matchlists,
    tables,
    counts: {
      matches: all.length,
      played: all.filter((m) => m.finished).length,
      live: all.filter((m) => m.live).length,
      upcoming: all.filter((m) => m.upcoming).length,
    },
  };
}

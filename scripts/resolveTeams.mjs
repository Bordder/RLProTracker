// Liquipedia's short team codes, resolved to the names people use.
//
//   node resolveTeams.mjs "Rocket League Championship Series/2026" worlds-2026
//
// A bracket writes the code, not the name: {{TeamOpponent|flcn}}, {{TeamOpponent|vp}}.
// Nothing in the wikitext says what those stand for, because the expansion
// happens in Liquipedia's own team database, so a page read through the query
// API alone renders "flcn" against "vp" and the board looks broken.
//
// The rendered page does say, in as many words. Every team it draws carries
//
//   <div class="team-name-dynamic" data-team-shortname="FLCN"
//        data-team-bracketname="Team Falcons" data-team-name="Team Falcons">
//
// so one action=parse render of the event page is the whole mapping, stated by
// the source rather than guessed at by pairing lists in document order - which
// is what makes this safe to run unattended. The alternative considered and
// rejected: zip the wikitext's opponents against the rendered team spans by
// position. Measured on the Worlds page, those two orders differ (the rankings
// table sorts its own way), and a mispairing puts the wrong org's name and
// crest on a match.
//
// This is deliberately a SEPARATE step from the collector. action=parse is
// limited to one request per 30 seconds against the query API's one per 2, and
// team names change on the order of months while scores change on the order of
// minutes.

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { FIXTURE_DIR, UA } from "./assemble.mjs";
import { pathToFileURL } from "node:url";

const attr = (s, k) => new RegExp(`data-team-${k}="([^"]*)"`).exec(s)?.[1] ?? null;

/**
 * Every name a rendered page uses for a team, keyed lower case.
 *
 * Both directions: the short code from the bracket, the full name from a
 * participant table, and the bracket name where a team is drawn under
 * something shorter than its full one.
 *
 * @returns { teams: Set<string>, alias: { [lowercased]: displayName } }
 */
export function teamsFromRender(html) {
  const alias = {};
  const teams = new Set();
  for (const m of String(html).matchAll(/<div class="team-name-dynamic"([^>]*)><\/div>/g)) {
    const name = attr(m[1], "name");
    if (!name) continue;
    teams.add(name);
    for (const key of [attr(m[1], "shortname"), attr(m[1], "bracketname"), name]) {
      if (key) alias[key.toLowerCase()] = name;
    }
  }
  return { teams, alias };
}

// Run only when invoked directly. Not import.meta.main, which needs Node 22.18
// or 24.2: package.json allows Node 20, where it is undefined and this script
// exited 0 having done nothing.
if (!(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  // Imported for teamsFromRender alone: no page to fetch, nothing to write.
} else {

const [title, slug] = process.argv.slice(2);
if (!title || !slug) {
  console.error('usage: node resolveTeams.mjs "<page title>" <event-slug>');
  process.exit(1);
}

const url =
  "https://liquipedia.net/rocketleague/api.php?action=parse&format=json&prop=text&page=" +
  encodeURIComponent(title);

const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip" } });
if (!res.ok) throw new Error(`HTTP ${res.status} for ${title}`);
const body = await res.json();
if (body.error) throw new Error(`${body.error.code}: ${body.error.info}`);
const html = body.parse?.text?.["*"];
if (typeof html !== "string" || html.length < 1000) throw new Error(`no rendered text for ${title}`);

const { teams, alias } = teamsFromRender(html);

// A page with no bracket drawn yet renders no dynamic names at all, and writing
// an empty map over a good one would un-resolve every team on the site.
if (!teams.size) throw new Error(`no team names in the render of ${title} - nothing to write`);

const out = join(FIXTURE_DIR, `teams-${slug}.json`);

// Hand-written entries survive a refresh, and win.
//
// Some codes have no dynamic name to read: a team whose Liquipedia template
// was retired renders as plain text, so the 2024 pages say "geng" and "rstv"
// and no amount of re-resolving will produce a name for them. Those go in
// "manual" by hand, once, and this must not wipe them on the next run.
const manual = await readFile(out, "utf8")
  .then((raw) => JSON.parse(raw).manual ?? {})
  .catch(() => ({}));
for (const [k, v] of Object.entries(manual)) {
  alias[k.toLowerCase()] = v;
  teams.add(v);
}

const doc = {
  source: title,
  resolvedAt: new Date().toISOString(),
  note: "Liquipedia team alias (lower case) -> display name. From one action=parse render.",
  teams: [...teams].sort(),
  ...(Object.keys(manual).length ? { manual } : {}),
  alias,
};
await mkdir(dirname(out), { recursive: true });
await writeFile(`${out}.tmp`, `${JSON.stringify(doc, null, 2)}\n`);
await rename(`${out}.tmp`, out);

console.log(`${teams.size} team(s), ${Object.keys(alias).length} alias(es)\n`);
}

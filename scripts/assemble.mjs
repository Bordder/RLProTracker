// wikitext on disk -> bracket.json.
//
// Shared by build.mjs (one shot, offline) and collect.mjs (the loop), so the
// two cannot drift into producing different documents from the same input.

import { readFile, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parsePage } from "./parseBracket.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
// Two directories, deliberately not one.
//
// cache/    what the collector fetches and overwrites. Live, disposable.
// fixtures/ frozen wikitext the tests assert against, plus the team alias map.
//
// They were the same directory for one commit and it was a trap: the first
// live fetch of Worlds would have overwritten the fixture that pins the
// "every score empty, 47 upcoming" state - the only copy of the pre-event
// page that will ever exist, and the thing a whole test depends on.
export const CACHE_DIR = join(ROOT, "data", "bracket", "cache");
export const FIXTURE_DIR = join(ROOT, "data", "bracket", "fixtures");
export const OUT_PATH = join(ROOT, "data", "derived", "bracket.json");

export const UA = "RLProTracker/1.0 (https://198x.online; contact@198x.online)";
export const ATTRIBUTION = "Bracket data from Liquipedia, CC-BY-SA 3.0";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Alias -> display name. Falls back to the alias, so a team the map has never
 * seen still renders rather than vanishing.
 */
export async function loadTeams(slug) {
  try {
    const raw = await readFile(join(FIXTURE_DIR, `teams-${slug}.json`), "utf8");
    const { alias } = JSON.parse(raw);
    const names = [...new Set(Object.values(alias))];
    return (t) => {
      if (!t) return t;
      const exact = alias[t.toLowerCase()];
      if (exact) return exact;
      const low = t.toLowerCase();
      // "falcons" against "Team Falcons": Liquipedia's short form is FLCN, so
      // the alias is a word inside the name rather than any listed variant.
      const inside = names.find((n) => n.toLowerCase().includes(low));
      if (inside) return inside;
      // And the other direction: a group table writes "NRG Esports" where the
      // bracket writes "NRG", so the LONGER string is the one to fold. Three
      // characters minimum, on a word boundary, or "M80" starts matching
      // anything with those letters in it.
      const wraps = names
        .filter((n) => {
          if (n.length < 3) return false;
          const quoted = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          return new RegExp(`(^|\\W)${quoted}(\\W|$)`, "i").test(t);
        })
        .sort((a, b) => b.length - a.length)[0];
      return wraps ?? t;
    };
  } catch {
    return (t) => t;
  }
}

export const renameIn = (page, name) => {
  const fix = (m) => ({ ...m, teams: m.teams.map(name) });
  return {
    ...page,
    brackets: page.brackets.map((b) => ({ ...b, matches: b.matches.map(fix) })),
    matchlists: page.matchlists.map((l) => ({ ...l, matches: l.matches.map(fix) })),
    // The group tables need the same treatment as the matches, and for the
    // same reason: the Boston Major table says "Ninjas In Pyjamas" while its
    // own matches say "Ninjas in Pyjamas", so without this the standings and
    // the results underneath them spell the same org two ways on one card.
    tables: (page.tables ?? []).map((t) => ({
      ...t,
      rows: t.rows.map((r) => ({ ...r, team: r.team ? name(r.team) : r.team })),
    })),
  };
};

export const countStages = (stages) =>
  stages.reduce(
    (a, s) => ({
      matches: a.matches + s.counts.matches,
      played: a.played + s.counts.played,
      upcoming: a.upcoming + s.counts.upcoming,
    }),
    { matches: 0, played: 0, upcoming: 0 }
  );

/**
 * Read a title's wikitext from the cache, falling back to the frozen fixture.
 *
 * The fallback is what makes a fresh checkout work with no network: the cache
 * starts empty, and an empty cache should mean "show the fixture" rather than
 * "crash".
 */
export async function readCached(cache) {
  try {
    return await readFile(join(CACHE_DIR, cache), "utf8");
  } catch {
    return await readFile(join(FIXTURE_DIR, cache), "utf8");
  }
}

/**
 * The edge lists, keyed by bracket template name.
 *
 * Written by fetchShapes.mjs from Liquipedia's commons wiki. Missing is not
 * an error: a bracket with no shape simply draws no connectors, which is what
 * every bracket did before shapes existed.
 */
let SHAPES = null;
async function shapes() {
  if (SHAPES) return SHAPES;
  try {
    SHAPES = JSON.parse(await readFile(join(ROOT, "data", "bracket", "shapes.json"), "utf8"));
  } catch {
    SHAPES = {};
  }
  return SHAPES;
}

/** Parse one event from whatever wikitext is cached on disk. */
export async function parseEvent(event) {
  const stages = [];
  for (const t of event.titles) {
    const text = await readCached(t.cache);
    stages.push(parsePage(text, { stage: t.stage, source: t.title }));
  }
  const name = await loadTeams(event.slug);
  const named = stages.map((s) => renameIn(s, name));

  // Attach each bracket's real edge list, so the page needs no second fetch
  // and no guesswork about which match feeds which.
  const sh = await shapes();
  for (const st of named) {
    for (const b of st.brackets) b.edges = b.template ? (sh[b.template]?.edges ?? null) : null;
  }

  // The page describes itself. Anything set explicitly in events.json still
  // wins, so a bad infobox can always be overridden by hand, but nothing has
  // to be copied there just to render.
  const info = named[0]?.info ?? {};
  const merged = { ...event };
  for (const k of ["name", "city", "country", "venue", "starts", "ends", "teamCount", "prizePool", "twitch", "youtube"]) {
    if (merged[k] == null && info[k] != null) merged[k] = info[k];
  }
  if (!merged.name) merged.name = event.slug;

  return { ...merged, stages: named, counts: countStages(named) };
}

export const buildDoc = (events, source) => ({
  generatedAt: new Date().toISOString(),
  source,
  // Required by Liquipedia's terms wherever this is displayed.
  attribution: ATTRIBUTION,
  events,
});

/**
 * Write via a temporary file and rename.
 *
 * The preview server reads this file while the collector writes it, and a
 * plain write leaves a window where a reader gets half a document and a JSON
 * parse error. rename is atomic on the same filesystem.
 */
export async function writeAtomic(path, text) {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path);
}

/** One request for one page's wikitext. Throws on anything unusable. */
export async function fetchWikitext(title, { signal } = {}) {
  const url =
    "https://liquipedia.net/rocketleague/api.php?action=query&prop=revisions" +
    `&rvprop=content&rvslots=main&format=json&titles=${encodeURIComponent(title)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Encoding": "gzip" },
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const page = Object.values((await res.json()).query.pages)[0];
  if (!page?.revisions) throw new Error(`no such page: ${title}`);
  const text = page.revisions[0].slots.main["*"];
  // A page that suddenly parses to nothing is far more likely to be an API
  // hiccup than a real edit, and overwriting the cache with it would throw
  // away the last good copy.
  if (typeof text !== "string" || text.length < 1000) throw new Error(`suspiciously short page: ${title}`);
  return text;
}

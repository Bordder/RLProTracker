// Build data/roster.json from data/teams.json (RLCS field) via Liquipedia.
// Uses the MediaWiki *query* API to batch many player pages per request
// (titles=A|B|C...), which is far lighter on Liquipedia than per-page parse
// calls and avoids the rate limiter. Extracts each player's Steam identity
// (SteamID64 from /profiles/<id>, or vanity from /id/<name>).
//
// Two passes, each resuming independently:
//   1. Steam identity, for players that have none yet.
//   2. Nationality and Twitch channel, for players with no profile stamp yet.
//
// They are separate requests on purpose. `ellimit` caps external links across
// the WHOLE batch rather than per page, and a single player page can carry
// twenty-odd links, so asking for unfiltered extlinks for fifty players would
// silently truncate and lose the Steam link for everyone at the end of the
// batch. One narrow `elquery` per pass keeps each response small and complete.
//
// Liquipedia API etiquette: keep requests slow + a descriptive User-Agent.
// https://liquipedia.net/api-terms-of-use
//
// Usage:  npm run fetch:roster   (resumes: skips players already resolved)
//         npm run fetch:roster -- --refresh-profiles   (re-read country + twitch)

import { readFile, writeFile } from "node:fs/promises";
import { profileFrom, looksWrongPerson } from "./profiles.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://liquipedia.net/rocketleague/api.php";
// Non-personal contact per Liquipedia etiquette. Override with LIQUIPEDIA_UA
// (e.g. your GitHub repo URL) if you want a reachable contact - never a personal email in a public repo.
const UA = process.env.LIQUIPEDIA_UA || "RL-Pro-Tracker/0.1 (+https://github.com/rl-pro-tracker)";
const CHUNK = 50;          // titles per request (MediaWiki query max) - 47 remaining = 1 request
const CHUNK_DELAY = 6000;  // between chunks (rarely hit at CHUNK=50)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Fields the profile pass owns, carried forward from the previous file. They are
// independent of Steam resolution: a player Steam never resolved, or one keyed
// by an Epic name, still has a Liquipedia page with a nationality on it.
//
// `profileAt` is the resume marker. It records that the page was READ, which is
// not the same as it having said anything - a player with no Twitch channel and
// an unmapped country is fully resolved with both fields null, and without this
// stamp the pass would fetch them again on every run forever.
const carry = (prev) => ({
  country: prev?.country ?? null,
  country2: prev?.country2 ?? null,
  twitch: prev?.twitch ?? null,
  profileAt: prev?.profileAt ?? null,
});

async function query(extra, titles) {
  const params = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", redirects: "1",
    ...extra, titles: titles.join("|"),
  });
  const url = `${API}?${params}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip" } });
    if (res.status === 429) { const w = 15000 * (attempt + 1); console.log(`    429 - backoff ${w / 1000}s`); await sleep(w); continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  throw new Error("HTTP 429 (gave up)");
}

const queryExtlinks = (titles) =>
  query({ prop: "extlinks", ellimit: "max", elquery: "steamcommunity.com" }, titles);

// Nationality and Twitch in one request. The infobox is only in the page source,
// so this is the one call that carries wikitext; at fifty pages it is a few
// hundred KB, which is why Accept-Encoding: gzip is not optional here.
const queryProfiles = (titles) =>
  query({
    prop: "revisions|extlinks|categories", rvprop: "content", rvslots: "main",
    cllimit: "max", ellimit: "max", elquery: "twitch.tv",
  }, titles);

// map an original title through normalization + redirects to the final page title
function buildResolver(q) {
  const norm = new Map((q.normalized ?? []).map((n) => [n.from, n.to]));
  const redir = new Map((q.redirects ?? []).map((r) => [r.from, r.to]));
  return (title) => {
    let t = norm.get(title) ?? title;
    t = redir.get(t) ?? t;
    return t;
  };
}

function steamFromLinks(links) {
  const urls = (links ?? []).map((l) => l.url);
  for (const u of urls) { const m = u.match(/steamcommunity\.com\/profiles\/(\d{17})/); if (m) return { steamId64: m[1], vanity: null }; }
  for (const u of urls) { const m = u.match(/steamcommunity\.com\/id\/([^/?#]+)/); if (m) return { steamId64: null, vanity: decodeURIComponent(m[1]) }; }
  return { steamId64: null, vanity: null };
}

async function loadResolved() {
  try {
    const prev = JSON.parse(await readFile(join(ROOT, "data", "roster.json"), "utf8"));
    // Every previous entry, not only the ones with a Steam link. The country and
    // Twitch fields have to survive a re-run for players Steam resolution never
    // found, otherwise the second pass would refetch the whole roster each time.
    // "Has this player been resolved" is asked of the fields below, not of
    // membership in this map.
    const map = new Map();
    for (const p of prev.players ?? []) if (p.id) map.set(p.id, p);
    return map;
  } catch { return new Map(); }
}

async function loadOverrides() {
  try {
    const o = JSON.parse(await readFile(join(ROOT, "data", "overrides.json"), "utf8"));
    return { steam: o.steamId64 ?? {}, epic: o.epic ?? {}, twitch: o.twitch ?? {}, title: o.liquipedia ?? {} };
  } catch { return { steam: {}, epic: {}, twitch: {}, title: {} }; }
}

async function main() {
  const { teams, freeAgents = [], season } = JSON.parse(await readFile(join(ROOT, "data", "teams.json"), "utf8"));
  const resolved = await loadResolved();
  const overrides = await loadOverrides();

  // flatten roster, mark which still need fetching
  const players = [];
  for (const team of teams) {
    for (const title of team.players) {
      const id = slug(`${team.name}-${title}`);
      const cached = resolved.get(id);
      // A player who does not play on Steam is keyed by their Epic name instead.
      // tracker.gg serves the same profile either way, and Steam's playtime API
      // has nothing to say about them, so there is no id to look up.
      const epic = overrides.epic[id];
      if (epic) {
        players.push({ id, name: title, team: team.name, stage: team.stage, steamId64: null, epic, vanity: null, liquipedia: title, status: "epic", ...carry(cached) });
        continue;
      }
      const override = overrides.steam[id];
      if (override) {
        // manual correction always wins; no lookup needed
        players.push({ id, name: title, team: team.name, stage: team.stage, steamId64: override, vanity: null, liquipedia: title, status: "override", ...carry(cached) });
        continue;
      }
      players.push({
        id, name: title, team: team.name, stage: team.stage,
        steamId64: cached?.steamId64 ?? null, vanity: cached?.vanity ?? null,
        liquipedia: title,
        // Steam resolution only, which is what this status has always meant.
        // A cached entry with no Steam identity is still pending here.
        status: cached?.steamId64 || cached?.vanity ? "cached" : "pending",
        ...carry(cached),
      });
    }
  }

  // Players with no team. The board already renders "Free agent" wherever a
  // team would go, so this only has to produce a player with team: null. The id
  // is slugged from the name alone, since there is no team to qualify it - so
  // free-agent names must be unique among themselves, which a duplicate check
  // below enforces rather than leaving two players to overwrite each other.
  for (const fa of freeAgents) {
    const title = typeof fa === "string" ? fa : fa.name;
    const id = slug(title);
    if (players.some((p) => p.id === id)) throw new Error(`duplicate free-agent id: ${id}`);
    const cached = resolved.get(id);
    const epic = overrides.epic[id];
    if (epic) {
      players.push({ id, name: title, team: null, stage: null, steamId64: null, epic, vanity: null, liquipedia: title, status: "epic", ...carry(cached) });
      continue;
    }
    const override = overrides.steam[id] ?? (typeof fa === "object" ? fa.steamId64 : null);
    if (override) {
      players.push({ id, name: title, team: null, stage: null, steamId64: override, vanity: null, liquipedia: title, status: "override", ...carry(cached) });
      continue;
    }
    players.push({
      id, name: title, team: null, stage: null,
      steamId64: cached?.steamId64 ?? null, vanity: cached?.vanity ?? null,
      liquipedia: title,
      status: cached?.steamId64 || cached?.vanity ? "cached" : "pending",
      ...carry(cached),
    });
  }

  // Point a player at the right page before anything is fetched, so both passes
  // read the same one. Liquipedia gives the bare title to whoever held it first:
  // "Juicy" is a Dutch caster, and the Karmine Corp player is under "Juicy
  // (French Player)". Reading the wrong page is silent - it publishes another
  // person's nationality, Twitch channel and Steam link under this player's name.
  for (const p of players) {
    const t = overrides.title[p.id];
    if (t) p.liquipedia = t;
  }

  const todo = players.filter((p) => p.status === "pending");
  console.log(`${players.length} players, ${players.length - todo.length} cached, ${todo.length} to fetch\n`);

  const save = async () => {
    // Applied here rather than at the point the fetch sets the field, so the
    // override holds no matter which pass wrote last and no matter how the file
    // is rebuilt. `null` is a real value meaning "this player has no channel" -
    // hence the key test rather than a truthiness one, which would let a wrong
    // channel come straight back on the next run.
    for (const p of players) {
      if (Object.prototype.hasOwnProperty.call(overrides.twitch, p.id)) p.twitch = overrides.twitch[p.id] ?? null;
    }
    const withSteam = players.filter((p) => p.steamId64 || p.vanity).length;
    await writeFile(
      join(ROOT, "data", "roster.json"),
      JSON.stringify({ note: "Auto-generated from teams.json via Liquipedia query API.", season, generatedAt: new Date().toISOString(), players }, null, 2)
    );
    return withSteam;
  };

  for (let i = 0; i < todo.length; i += CHUNK) {
    const batch = todo.slice(i, i + CHUNK);
    const titles = [...new Set(batch.map((p) => p.liquipedia))];
    let data;
    try { data = await queryExtlinks(titles); }
    catch (e) { for (const p of batch) p.status = `error: ${e.message}`; console.log(`  batch ${i / CHUNK + 1}: ${e.message}`); continue; }

    const resolveTitle = buildResolver(data.query);
    const byTitle = new Map((data.query.pages ?? []).map((pg) => [pg.title, pg]));

    for (const p of batch) {
      const finalTitle = resolveTitle(p.liquipedia);
      const page = byTitle.get(finalTitle);
      if (!page || page.missing) { p.status = "page-missing"; }
      else {
        const s = steamFromLinks(page.extlinks);
        p.steamId64 = s.steamId64; p.vanity = s.vanity;
        p.status = s.steamId64 || s.vanity ? "ok" : "no-steam-link";
      }
      // A free agent has team: null, and null.padEnd threw here, killing the
      // run before the batch was saved.
      console.log(`  ${(p.team ?? "Free agent").padEnd(20)} ${p.name.padEnd(14)} ${p.status.padEnd(13)} ${p.steamId64 ?? p.vanity ?? "-"}`);
    }
    await save(); // persist after every chunk so progress survives
    if (i + CHUNK < todo.length) await sleep(CHUNK_DELAY);
  }

  // ---- pass 2: nationality and Twitch ------------------------------------
  //
  // Independent of pass 1. A player whose Steam link was never found still has a
  // page with a country on it, and refetching a page whose country this build
  // does not recognise would achieve nothing, so the marker is "page read".
  const needProfile = players.filter((p) => !p.profileAt && p.liquipedia);
  const force = process.argv.includes("--refresh-profiles");
  const profileTodo = force ? players.filter((p) => p.liquipedia) : needProfile;
  if (profileTodo.length) {
    console.log(`\nprofiles: ${profileTodo.length} to fetch (country, twitch)`);
    const unmapped = new Map();
    const suspect = [];
    for (let i = 0; i < profileTodo.length; i += CHUNK) {
      const batch = profileTodo.slice(i, i + CHUNK);
      const titles = [...new Set(batch.map((p) => p.liquipedia))];
      let data;
      try { data = await queryProfiles(titles); }
      catch (e) { console.log(`  batch ${i / CHUNK + 1}: ${e.message}`); continue; }

      const resolveTitle = buildResolver(data.query);
      const byTitle = new Map((data.query.pages ?? []).map((pg) => [pg.title, pg]));
      const at = new Date().toISOString();

      for (const p of batch) {
        const page = byTitle.get(resolveTitle(p.liquipedia));
        if (!page || page.missing) { console.log(`  ${p.name.padEnd(16)} page-missing`); continue; }
        const wrong = looksWrongPerson(page);
        if (wrong) suspect.push({ name: p.name, id: p.id, title: page.title, ...wrong });
        const prof = profileFrom(page);
        p.country = prof.country;
        p.country2 = prof.country2;
        p.twitch = prof.twitch;
        p.profileAt = at;
        for (const n of prof.unmapped) unmapped.set(n, (unmapped.get(n) ?? 0) + 1);
        const named = [p.country, p.country2].filter(Boolean).map((c) => c.code).join("+");
        const flag = named || (prof.unmapped.length ? `? ${prof.unmapped.join(", ")}` : "-");
        console.log(`  ${p.name.padEnd(16)} ${flag.padEnd(24)} ${p.twitch ? `twitch.tv/${p.twitch}` : ""}`);
      }
      await save();
      if (i + CHUNK < profileTodo.length) await sleep(CHUNK_DELAY);
    }
    // Loud, because a name this table does not know is a player with no flag,
    // and the fix is one line in scripts/countries.mjs.
    // A page that is not a player page is almost always the wrong person, and
    // the damage is silent, so this is reported before anything else.
    if (suspect.length) {
      console.log(`
  NOT A PLAYER PAGE - check these, and add a liquipedia override in data/overrides.json:`);
      for (const w of suspect) {
        console.log(`    ${w.name} -> "${w.title}"${w.role ? ` (role: ${w.role})` : ""}`);
        console.log(`      id ${w.id}; categories: ${w.categories.join(", ")}`);
      }
    }
    if (unmapped.size) {
      console.log(`\n  UNMAPPED COUNTRY NAMES - add these to scripts/countries.mjs:`);
      for (const [name, n] of [...unmapped].sort((a, b) => b[1] - a[1])) console.log(`    ${name} (${n} player${n === 1 ? "" : "s"})`);
    }
  }

  const withSteam = await save();
  const withFlag = players.filter((p) => p.country?.code).length;
  const withTwitch = players.filter((p) => p.twitch).length;
  console.log(`\nroster.json: ${players.length} players, ${withSteam} with Steam identity, ${players.length - withSteam} missing`);
  console.log(`             ${withFlag} with a country, ${withTwitch} with a Twitch channel`);
}

main().catch((e) => { console.error(e); process.exit(1); });

// Build data/roster.json from data/teams.json (RLCS field) via Liquipedia.
// Uses the MediaWiki *query* API to batch many player pages per request
// (titles=A|B|C...), which is far lighter on Liquipedia than per-page parse
// calls and avoids the rate limiter. Extracts each player's Steam identity
// (SteamID64 from /profiles/<id>, or vanity from /id/<name>).
//
// Liquipedia API etiquette: keep requests slow + a descriptive User-Agent.
// https://liquipedia.net/api-terms-of-use
//
// Usage:  npm run fetch:roster   (resumes: skips players already resolved)

import { readFile, writeFile } from "node:fs/promises";
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

async function queryExtlinks(titles) {
  const params = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", redirects: "1",
    prop: "extlinks", ellimit: "max", elquery: "steamcommunity.com",
    titles: titles.join("|"),
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
    const map = new Map();
    for (const p of prev.players ?? []) if (p.steamId64 || p.vanity) map.set(p.id, p);
    return map;
  } catch { return new Map(); }
}

async function loadOverrides() {
  try {
    const o = JSON.parse(await readFile(join(ROOT, "data", "overrides.json"), "utf8"));
    return { steam: o.steamId64 ?? {}, epic: o.epic ?? {} };
  } catch { return { steam: {}, epic: {} }; }
}

async function main() {
  const { teams, season } = JSON.parse(await readFile(join(ROOT, "data", "teams.json"), "utf8"));
  const resolved = await loadResolved();
  const overrides = await loadOverrides();

  // flatten roster, mark which still need fetching
  const players = [];
  for (const team of teams) {
    for (const title of team.players) {
      const id = slug(`${team.name}-${title}`);
      // A player who does not play on Steam is keyed by their Epic name instead.
      // tracker.gg serves the same profile either way, and Steam's playtime API
      // has nothing to say about them, so there is no id to look up.
      const epic = overrides.epic[id];
      if (epic) {
        players.push({ id, name: title, team: team.name, stage: team.stage, steamId64: null, epic, vanity: null, liquipedia: title, status: "epic" });
        continue;
      }
      const override = overrides.steam[id];
      if (override) {
        // manual correction always wins; no lookup needed
        players.push({ id, name: title, team: team.name, stage: team.stage, steamId64: override, vanity: null, liquipedia: title, status: "override" });
        continue;
      }
      const cached = resolved.get(id);
      players.push({
        id, name: title, team: team.name, stage: team.stage,
        steamId64: cached?.steamId64 ?? null, vanity: cached?.vanity ?? null,
        liquipedia: title, status: cached ? "cached" : "pending",
      });
    }
  }

  const todo = players.filter((p) => p.status === "pending");
  console.log(`${players.length} players, ${players.length - todo.length} cached, ${todo.length} to fetch\n`);

  const save = async () => {
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
      console.log(`  ${p.team.padEnd(20)} ${p.name.padEnd(14)} ${p.status.padEnd(13)} ${p.steamId64 ?? p.vanity ?? "-"}`);
    }
    await save(); // persist after every chunk so progress survives
    if (i + CHUNK < todo.length) await sleep(CHUNK_DELAY);
  }

  const withSteam = await save();
  console.log(`\nroster.json: ${players.length} players, ${withSteam} with Steam identity, ${players.length - withSteam} missing`);
}

main().catch((e) => { console.error(e); process.exit(1); });

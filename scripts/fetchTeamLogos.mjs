// Download each org's logo from Liquipedia into web/img/teams/<slug>.<ext>
// and print the TEAM_LOGO literal for web/index.html.
//
// Liquipedia hosts team logos under a naming convention:
//   File:<Team> [year] [full] <allmode|darkmode|lightmode>.png
// so we list each team page's images, keep the ones whose name starts with the
// team's own name, and pick the best variant. The site is dark, so allmode and
// darkmode are preferred over lightmode; the compact mark is preferred over the
// "full" wordmark because marks render in a 32px square tile; newer years win.
//
// Liquipedia API etiquette: descriptive User-Agent, batched queries, slow
// downloads.  https://liquipedia.net/api-terms-of-use
//
// Usage:  node scripts/fetchTeamLogos.mjs

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { teamSlug } from "./teamSlugs.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "web", "img", "teams");
const API = "https://liquipedia.net/rocketleague/api.php";
const UA = process.env.LIQUIPEDIA_UA || "RL-Pro-Tracker/0.1 (+https://github.com/Bordder/RLProTracker)";
const DOWNLOAD_DELAY = 2000; // between image downloads

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip" } });
    if (res.status === 429) { const w = 15000 * (attempt + 1); console.log(`    429 - backoff ${w / 1000}s`); await sleep(w); continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  throw new Error("HTTP 429 (gave up)");
}

// All images on the given pages, following imcontinue. Returns Map<origTitle, string[]>.
async function imagesFor(titles, resolvedInto) {
  const out = new Map(titles.map((t) => [t, []]));
  let cont;
  for (let guard = 0; guard < 40; guard++) {
    const j = await api({
      action: "query", redirects: "1", prop: "images", imlimit: "max",
      titles: titles.join("|"), ...(cont ? { imcontinue: cont } : {}),
    });
    // map resolved title back to the title we asked for
    const back = new Map();
    for (const n of j.query?.normalized ?? []) back.set(n.to, n.from);
    for (const r of j.query?.redirects ?? []) back.set(r.to, back.get(r.from) ?? r.from);
    for (const pg of j.query?.pages ?? []) {
      const orig = back.get(pg.title) ?? pg.title;
      if (!out.has(orig)) out.set(orig, []);
      if (resolvedInto) resolvedInto.set(orig, pg.title);
      for (const im of pg.images ?? []) out.get(orig).push(im.title);
    }
    cont = j.continue?.imcontinue;
    if (!cont) break;
  }
  return out;
}

// Orgs whose logo still sits under a former name on Liquipedia.
const ALIASES = {
  "FUT Esports": ["Futbolist"],          // org renamed; logo still under the old name
  "Man City Esports": ["Manchester City"], // logo file drops the "Esports" suffix
};

// Explicit picks that override scoring. The heuristic optimises for a square
// shape in a 32px tile, which is usually right but sometimes lands on an older
// mark when the current branding happens to be wide.
const PINNED = {
  "NRG": "File:NRG 2024 allmode.png",              // current wordmark, wide but correct
  "Twisted Minds": "File:Twisted Minds 2023 allmode.png",
};

// Files on a team page that plausibly are that team's own logo.
// `names` covers the team name, the page title it redirects to (Man City ->
// Manchester City) and any former name.
function candidates(names, files) {
  const wants = names.filter(Boolean).map(key);
  return files.filter((f) => { const k = key(f.replace(/^File:/, "")); return wants.some((w) => k.startsWith(w)); })
    .filter((f) => /\.(png|svg)$/i.test(f))          // skip event photos (.jpg)
    .filter((f) => !/icon|award|trophy/i.test(f));
}

// Rank candidates. Marks render inside a 32px square, so shape matters most:
// a wide wordmark scaled to fit becomes an unreadable sliver. Aspect ratio is
// judged from the real dimensions rather than guessed from the filename,
// because plenty of wordmarks are not labelled "full" or "text".
function scoreFile(f, info) {
  const n = f.toLowerCase();
  let s = 0;

  if (info?.width && info?.height) {
    const ratio = Math.max(info.width, info.height) / Math.min(info.width, info.height);
    if (ratio <= 1.25) s += 60;        // square-ish: ideal
    else if (ratio <= 1.8) s += 30;
    else if (ratio <= 2.6) s += 5;
    else s -= 40;                       // 3:1 and wider is a wordmark
  }
  if (!/\b(full|text|wordmark)\b/.test(n)) s += 25;

  const year = (f.match(/\b(20\d\d)\b/) || [])[1];
  if (year) s += (Number(year) - 2010) * 3;          // newest branding wins

  if (n.includes("allmode")) s += 12;
  else if (n.includes("darkmode")) s += 10;          // site is dark
  else if (n.includes("lightmode")) s += 0;
  if (n.endsWith(".svg")) s += 6;
  return s;
}

// Ask MediaWiki for a THUMB_WIDTH-wide rendition rather than the original:
// marks display in a 32px tile, and the source files run to several hundred KB
// each. Falls back to the original when no thumbnail is offered (e.g. SVG).
const THUMB_WIDTH = 128;

// url + real dimensions for each file, so shape can be scored before choosing.
async function fileInfo(fileTitles) {
  const out = new Map();
  for (let i = 0; i < fileTitles.length; i += 40) {
    const group = fileTitles.slice(i, i + 40);
    const j = await api({
      action: "query", prop: "imageinfo", iiprop: "url|size",
      iiurlwidth: String(THUMB_WIDTH), titles: group.join("|"),
    });
    for (const pg of j.query?.pages ?? []) {
      const info = pg.imageinfo?.[0];
      if (!info) continue;
      out.set(pg.title, { url: info.thumburl || info.url, width: info.width, height: info.height });
    }
    await sleep(500);
  }
  return out;
}

async function main() {
  const teams = JSON.parse(await readFile(join(ROOT, "data", "teams.json"), "utf8")).teams.map((t) => t.name);
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`listing images for ${teams.length} team pages...`);
  const resolved = new Map();
  const images = await imagesFor(teams, resolved);

  // Collect every candidate first, look up their dimensions in one batch, then
  // choose - shape can only be judged once the real size is known.
  const perTeam = teams.map((name) => {
    const found = candidates([name, resolved.get(name), ...(ALIASES[name] ?? [])], images.get(name) ?? []);
    const pin = PINNED[name];
    return { name, slug: teamSlug(name), cands: pin && found.includes(pin) ? [pin] : found };
  });
  const info = await fileInfo([...new Set(perTeam.flatMap((t) => t.cands))]);

  const picks = perTeam.map((t) => {
    const file = t.cands.slice()
      .sort((a, b) => scoreFile(b, info.get(b)) - scoreFile(a, info.get(a)) || a.length - b.length)[0] ?? null;
    if (!file) console.log(`  MISS ${t.name}`);
    return { ...t, file };
  });

  const saved = [];
  for (const p of picks) {
    const url = p.file ? info.get(p.file)?.url : null;
    if (!url) continue;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) { console.log(`  FAIL ${p.name}: HTTP ${res.status}`); continue; }
    const ext = (url.match(/\.(png|svg)$/i) || [, "png"])[1].toLowerCase();
    await writeFile(join(OUT_DIR, `${p.slug}.${ext}`), Buffer.from(await res.arrayBuffer()));
    saved.push({ ...p, ext });
    const d = info.get(p.file);
    const shape = d?.width && d?.height ? `${d.width}x${d.height}` : "?";
    console.log(`  ok   ${p.name.padEnd(22)} ${p.file.replace(/^File:/, "").padEnd(38)} ${shape}`);
    await sleep(DOWNLOAD_DELAY);
  }

  console.log(`\nsaved ${saved.length}/${teams.length} logos to web/img/teams`);

  // Write the map into rlpt.js rather than printing it to be pasted: every
  // logo downloaded but not listed there is a file nobody sees.
  const dir = await readdir(OUT_DIR).catch(() => []);
  const onDisk = new Map();
  for (const f of dir) {
    const m = f.match(/^(.+)\.(png|svg|webp)$/i);
    if (m) onDisk.set(m[1], m[2].toLowerCase());
  }
  if (onDisk.size) {
    const SITE = join(ROOT, "web", "rlpt.js");
    const src = await readFile(SITE, "utf8");
    const literal = `  var TEAM_LOGO={${[...onDisk.entries()].sort().map(([slug, ext]) => `'${slug}':'${ext}'`).join(",")}};`;
    const next = src.replace(/^ {2}var TEAM_LOGO=\{[^}]*\};$/m, literal);
    if (next === src) {
      console.log("could not find the TEAM_LOGO line in web/rlpt.js; map unchanged:");
      console.log(literal);
    } else {
      await writeFile(SITE, next);
      console.log(`web/rlpt.js: TEAM_LOGO now lists ${onDisk.size} crests`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

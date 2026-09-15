// Team marks, from Wikimedia Commons only.
//
// The rule this follows is the one already written into
// web/img/teams/sources.json: a mark made of type and simple shapes falls
// below the threshold of originality and carries no copyright, and Commons
// says so explicitly on each file page. Those are safe to host. Anything
// whose licence template is not a public-domain one is skipped rather than
// taken, so nothing arrives here on somebody else's fair-use claim.
//
// Commons is also the reason this does not hit Liquipedia: their images are
// not freely licensed and their terms are explicit about it.
//
//   node fetchLogos.mjs           what is missing, and what Commons has
//   node fetchLogos.mjs --write   download the ones that pass

import { readFile, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { UA, sleep } from "./assemble.mjs";
import { teamSlug } from "../web/crest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DIR = join(ROOT, "web", "img", "teams");
const API = "https://commons.wikimedia.org/w/api.php";
const WRITE = process.argv.includes("--write");

// Be a good citizen even where no limit is published.
const SPACING = 700;
let last = 0;
async function api(params) {
  const wait = SPACING - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const url = `${API}?${new URLSearchParams({ format: "json", origin: "*", ...params })}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// The licence templates that mean "no copyright to infringe". Anything else
// - CC-BY-SA, a fair-use tag, an unreviewed upload - is not taken.
// Commons spells the same tag several ways depending on how the file was
// categorised: "PD-textlogo", "PD textlogo", "PD-ineligible". Normalising the
// separator first is the difference between finding Dignitas and finding
// nothing - the first pass matched two files out of thirty-seven because of
// this alone.
const FREE = /^(pdtextlogo|pdshape|pdineligible|pdsimple|pdlogo|pdold|cczero|ccpdmark)/;
const isFree = (cat) => FREE.test(cat.replace(/^Category:/, "").toLowerCase().replace(/[\s_-]+/g, ""));

const looksRight = (title, team) => {
  const t = title.toLowerCase();
  if (!/\.(svg|png)$/i.test(t)) return false;
  if (/(wordmark|banner|jersey|photo|building|arena|kit)/.test(t)) return false;
  // The file has to name the org, or it is somebody else's logo that merely
  // matched the search.
  const head = team.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, "");
  return head.length >= 2 && t.replace(/[^a-z0-9]/g, "").includes(head);
};

async function candidates(team) {
  const r = await api({
    action: "query", list: "search", srnamespace: "6",
    srsearch: `${team} logo`, srlimit: "8",
  });
  return (r.query?.search ?? []).map((s) => s.title).filter((t) => looksRight(t, team));
}

async function inspect(title) {
  const r = await api({
    action: "query", titles: title, prop: "imageinfo|categories",
    iiprop: "url|size|mime", cllimit: "max",
  });
  const page = Object.values(r.query?.pages ?? {})[0];
  if (!page?.imageinfo) return null;
  const cats = (page.categories ?? []).map((c) => c.title);
  // Commons files carry their licence as a category, e.g.
  // "Category:PD-textlogo (auto)" or "Category:Public domain".
  const free = cats.some((c) => isFree(c) || /public domain/i.test(c));
  return { title, free, cats, ...page.imageinfo[0] };
}

const main = async () => {
  const doc = JSON.parse(await readFile(join(ROOT, "data", "derived", "bracket.json"), "utf8"));
  const names = new Set();
  for (const e of doc.events) for (const s of e.stages) {
    for (const b of s.brackets) for (const m of b.matches) m.teams.forEach((t) => t && names.add(t));
    for (const l of s.matchlists) for (const m of l.matches) m.teams.forEach((t) => t && names.add(t));
    for (const t of s.tables ?? []) for (const r of t.rows) r.team && names.add(r.team);
  }
  const have = new Set((await readdir(DIR)).map((f) => f.replace(/\.[a-z]+$/i, "")));

  // One entry per SLUG: "FURIA" and "FURIA Esports" are one org and one file.
  const want = new Map();
  for (const n of names) {
    const slug = teamSlug(n);
    if (have.has(slug) || slug.length < 2) continue;
    const prev = want.get(slug);
    if (!prev || n.length > prev.length) want.set(slug, n);
  }

  const found = [];
  const skipped = [];
  for (const [slug, team] of [...want].sort()) {
    let pick = null;
    for (const title of await candidates(team)) {
      const info = await inspect(title);
      if (!info) continue;
      // A free licence is not enough: the search happily returns the UFC for
      // "The Ultimates" and a Chinese diplomat for "gENG". The file has to be
      // categorised as an esports or gaming org, or it is somebody else's
      // logo that merely shares a word.
      if (info.free && !info.cats.some((c) => /esports|e-sports|gaming|video game/i.test(c))) {
        skipped.push(`${slug}: ${title} (free, but not an esports org: ${info.cats.slice(0, 2).join(", ")})`);
        continue;
      }
      if (!info.free) { skipped.push(`${slug}: ${title} (licence: ${info.cats.slice(0, 2).join(", ") || "none listed"})`); continue; }
      // Prefer SVG, then the larger raster.
      if (!pick || (/\.svg$/i.test(title) && !/\.svg$/i.test(pick.title))) pick = info;
    }
    if (pick) found.push({ slug, team, ...pick });
    else console.log(`no free file  ${slug}  (${team})`);
  }

  console.log(`\n${found.length} of ${want.size} teams have a public-domain mark on Commons:`);
  for (const f of found) console.log(`  ${f.slug}  <-  ${f.title}`);
  if (skipped.length) {
    console.log(`\nskipped, licence not public domain:`);
    for (const s of skipped) console.log(`  ${s}`);
  }
  if (!WRITE) return console.log(`\nnothing written. Re-run with --write to download.`);

  const sourcesPath = join(DIR, "sources.json");
  const sources = JSON.parse(await readFile(sourcesPath, "utf8"));
  for (const f of found) {
    const ext = /\.svg$/i.test(f.title) ? "svg" : "png";
    const res = await fetch(f.url, { headers: { "User-Agent": UA } });
    if (!res.ok) { console.log(`  failed ${f.slug}: HTTP ${res.status}`); continue; }
    await writeFile(join(DIR, `${f.slug}.${ext}`), Buffer.from(await res.arrayBuffer()));
    sources[f.slug] = {
      team: f.team,
      file: f.title,
      page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(f.title.replace(/ /g, "_"))}`,
      licence: "Public domain",
      fetchedAt: new Date().toISOString().slice(0, 10),
    };
    console.log(`  wrote ${f.slug}.${ext}`);
    await sleep(300);
  }
  await writeFile(sourcesPath, `${JSON.stringify(sources, null, 2)}\n`);
  console.log(`\nsources.json updated.`);
};

main().catch((e) => { console.error(e); process.exit(1); });

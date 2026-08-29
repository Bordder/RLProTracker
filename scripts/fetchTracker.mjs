// Collect ranked MMR and games-played per playlist for each rostered player
// from tracker.gg. tracker is Cloudflare-protected, so we drive a real headless
// Chromium (playwright-extra + stealth) and read the page's embedded state.
// One browser context is reused so the Cloudflare clearance carries across all
// players (only the first load takes the challenge).
//
// matchesPlayed is a season-cumulative count; games-per-window is derived later
// by diffing snapshots (see computeTrackerDeltas.mjs).
//
// Writes data/tracker-snapshots/tracker-<ts>.json.  Usage: npm run fetch:tracker

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";

chromium.use(stealth());

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PROFILE = (id) => `https://rocketleague.tracker.network/rocket-league/profile/steam/${id}/overview`;
const PLAYLISTS = { d1: "Ranked Duel 1v1", d2: "Ranked Doubles 2v2", d3: "Ranked Standard 3v3" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// runs in page context: pull rating/matches/tier for the three ranked playlists
function extractInPage(names) {
  const sp = window.__INITIAL_STATE__?.stats?.standardProfiles;
  if (!sp) return null;
  const prof = sp[Object.keys(sp)[0]];
  if (!prof?.segments) return null;
  const pick = (name) => {
    const s = prof.segments.find((x) => x.type === "playlist" && x.metadata?.name === name);
    if (!s) return null;
    return {
      rating: s.stats?.rating?.value ?? null,
      matches: s.stats?.matchesPlayed?.value ?? null,
      tier: s.stats?.tier?.metadata?.name ?? null,
    };
  };
  const out = {};
  for (const [k, n] of Object.entries(names)) out[k] = pick(n);
  return out;
}

async function scrapeOne(page, id) {
  await page.goto(PROFILE(id), { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForFunction(
    () => {
      const sp = window.__INITIAL_STATE__?.stats?.standardProfiles;
      if (!sp) return false;
      const k = Object.keys(sp);
      return k.length && sp[k[0]]?.segments?.some((s) => s.type === "playlist");
    },
    { timeout: 25000 }
  );
  return page.evaluate(extractInPage, PLAYLISTS);
}

async function main() {
  const roster = JSON.parse(await readFile(join(ROOT, "data", "roster.json"), "utf8"));
  let players = roster.players.filter((p) => p.steamId64);
  if (process.env.LIMIT) players = players.slice(0, +process.env.LIMIT); // testing subset
  const takenAt = new Date().toISOString();

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  // block heavy assets we don't need (images/fonts/media) for speed
  await page.route("**/*", (route) => {
    const t = route.request().resourceType();
    return ["image", "font", "media"].includes(t) ? route.abort() : route.continue();
  });

  const rows = [];
  for (const p of players) {
    const row = { id: p.id, name: p.name, team: p.team, steamId64: p.steamId64, status: "ok", playlists: null };
    try {
      const pl = await scrapeOne(page, p.steamId64);
      if (!pl) row.status = "no-data";
      else row.playlists = pl;
    } catch (e) {
      row.status = `error: ${e.message.split("\n")[0].slice(0, 60)}`;
    }
    const d2 = row.playlists?.d2;
    console.log(`  ${p.name.padEnd(14)} ${row.status.padEnd(12)} 2v2:${d2?.rating ?? "-"} (${d2?.matches ?? "-"} games)`);
    rows.push(row);
    await sleep(1200); // polite spacing between profiles
  }

  await browser.close();
  await mkdir(join(ROOT, "data", "tracker-snapshots"), { recursive: true });
  const file = join(ROOT, "data", "tracker-snapshots", `tracker-${takenAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(file, JSON.stringify({ takenAt, rows }, null, 2));
  const ok = rows.filter((r) => r.playlists).length;
  console.log(`\ntracker snapshot: ${file}\n${ok}/${rows.length} players with data`);
}

main().catch((e) => { console.error(e); process.exit(1); });

// Collect ranked MMR and games-played per playlist from tracker.gg.
//
// tracker is Cloudflare-protected, so we drive a headless Chromium
// (playwright-extra + stealth) that clears the challenge and read the page's
// embedded state (window.__INITIAL_STATE__).
//
// To stay under Cloudflare's rate limiting, each run scrapes only the most
// "overdue" players (see data/priorities.json): popular pros refresh hourly,
// others less often. Scheduling state lives in data/tracker-state.json so it
// persists across CI runs. matchesPlayed is season-cumulative; games-per-window
// is derived by diffing snapshots later (computeTrackerDeltas.mjs).
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
const STATE_FILE = join(ROOT, "data", "tracker-state.json");
const SPACING = 6000;   // between players, keeps us under Cloudflare rate limiting
const ATTEMPTS = 2;
const NAV_TIMEOUT = 40000;
const STATE_TIMEOUT = 45000; // give Cloudflare's challenge time to resolve
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stateReady() {
  const sp = window.__INITIAL_STATE__?.stats?.standardProfiles;
  if (!sp) return false;
  const k = Object.keys(sp);
  return k.length && sp[k[0]]?.segments?.some((s) => s.type === "playlist");
}

function extractInPage(names) {
  const sp = window.__INITIAL_STATE__?.stats?.standardProfiles;
  if (!sp) return null;
  const prof = sp[Object.keys(sp)[0]];
  if (!prof?.segments) return null;
  const pick = (name) => {
    const s = prof.segments.find((x) => x.type === "playlist" && x.metadata?.name === name);
    if (!s) return null;
    return { rating: s.stats?.rating?.value ?? null, matches: s.stats?.matchesPlayed?.value ?? null, tier: s.stats?.tier?.metadata?.name ?? null };
  };
  const out = {};
  for (const [k, n] of Object.entries(names)) out[k] = pick(n);
  return out;
}

const blockAssets = (page) =>
  page.route("**/*", (route) =>
    ["image", "font", "media", "stylesheet"].includes(route.request().resourceType()) ? route.abort() : route.continue()
  );

// Load the homepage once so Cloudflare issues a clearance cookie for the context
// before we hit profile pages. Best-effort; returns whether it cleared.
async function warmup(ctx) {
  const page = await ctx.newPage();
  try {
    await page.goto("https://rocketleague.tracker.network/", { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    await page.waitForFunction(() => !/just a moment/i.test(document.title), { timeout: STATE_TIMEOUT });
    return true;
  } catch { return false; }
  finally { await page.close().catch(() => {}); }
}

async function scrapeWithRetry(ctx, id) {
  let lastErr;
  for (let a = 1; a <= ATTEMPTS; a++) {
    const page = await ctx.newPage();
    try {
      await blockAssets(page);
      await page.goto(PROFILE(id), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
      try {
        await page.waitForFunction(stateReady, { timeout: STATE_TIMEOUT });
      } catch {
        // one reload often clears a stubborn Cloudflare challenge
        await page.reload({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
        await page.waitForFunction(stateReady, { timeout: STATE_TIMEOUT });
      }
      const data = await page.evaluate(extractInPage, PLAYLISTS);
      await page.close();
      if (data) return data;
      lastErr = new Error("no-data");
    } catch (e) {
      lastErr = e;
      await page.close().catch(() => {});
    }
    if (a < ATTEMPTS) await sleep(10000 * a);
  }
  throw lastErr;
}

const readJson = async (f, fallback) => { try { return JSON.parse(await readFile(f, "utf8")); } catch { return fallback; } };

// choose which players to scrape this run: most overdue first, capped at perRun.
// Each player has a target refresh interval in hours (data/priorities.json).
function selectDue(players, prio, state, now) {
  const defaultHours = prio.defaultHours ?? 12;
  const scored = players.map((p) => {
    let interval = (prio.players?.[p.id] ?? defaultHours) * 3600e3;
    const st = state[p.id] ?? {};
    if ((st.fails ?? 0) >= 3) interval *= 6; // back off chronically failing profiles
    const last = st.last ? Date.parse(st.last) : 0;
    return { p, score: (now - last) / interval };
  });
  scored.sort((a, b) => b.score - a.score);
  const perRun = process.env.LIMIT ? +process.env.LIMIT : prio.perRun ?? 10;
  return scored.slice(0, perRun).map((x) => x.p);
}

async function main() {
  const roster = await readJson(join(ROOT, "data", "roster.json"), { players: [] });
  const prio = await readJson(join(ROOT, "data", "priorities.json"), {});
  const state = await readJson(STATE_FILE, {});
  const all = roster.players.filter((p) => p.steamId64);
  const now = Date.now();
  const players = selectDue(all, prio, state, now);
  const takenAt = new Date(now).toISOString();
  console.log(`selected ${players.length}/${all.length} due players`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 800 } });

  const cleared = await warmup(ctx);
  console.log(`cloudflare warmup: ${cleared ? "cleared" : "not confirmed (continuing anyway)"}`);

  const rows = [];
  for (const p of players) {
    const row = { id: p.id, name: p.name, team: p.team, steamId64: p.steamId64, status: "ok", playlists: null };
    try {
      row.playlists = await scrapeWithRetry(ctx, p.steamId64);
      if (!row.playlists) row.status = "no-data";
    } catch (e) {
      row.status = `error: ${e.message.split("\n")[0].slice(0, 50)}`;
    }
    // update scheduling state:
    //  success   -> mark fresh
    //  no-data   -> genuine miss (no tracker profile); count toward backoff
    //  error     -> transient (Cloudflare/timeout); leave as-is so it stays due and retries next run
    const prev = state[p.id] ?? {};
    if (row.playlists) state[p.id] = { last: takenAt, fails: 0 };
    else if (row.status === "no-data") state[p.id] = { last: prev.last ?? null, fails: (prev.fails ?? 0) + 1 };
    else state[p.id] = prev;

    const d2 = row.playlists?.d2;
    console.log(`  ${p.name.padEnd(14)} ${row.status.padEnd(12)} 2v2:${d2?.rating ?? "-"} (${d2?.matches ?? "-"} games)`);
    rows.push(row);
    await sleep(SPACING);
  }

  await browser.close();

  await mkdir(join(ROOT, "data", "tracker-snapshots"), { recursive: true });
  const file = join(ROOT, "data", "tracker-snapshots", `tracker-${takenAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(file, JSON.stringify({ takenAt, rows }, null, 2));
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
  const ok = rows.filter((r) => r.playlists).length;
  console.log(`\ntracker snapshot: ${file}\n${ok}/${rows.length} scraped ok`);
}

main().catch((e) => { console.error(e); process.exit(1); });

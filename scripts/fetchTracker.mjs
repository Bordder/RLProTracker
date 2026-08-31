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
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";

chromium.use(stealth());

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PROFILE = (id) => `https://rocketleague.tracker.network/rocket-league/profile/steam/${id}/overview`;
const PLAYLISTS = { d1: "Ranked Duel 1v1", d2: "Ranked Doubles 2v2", d3: "Ranked Standard 3v3" };
const STATE_FILE = join(ROOT, "data", "tracker-state.json");
const ATTEMPTS = 5; // capped at proxy count in scrapePlayer; try every proxy before giving up
const NAV_TIMEOUT = 45000;
const STATE_TIMEOUT = 30000; // a warm profile hydrates well under this
const PER_PROXY_DELAY = 1000; // small gap between a worker's consecutive loads
// How many pages scrape at once. Concurrency hurts here on two fronts: it
// starves CPU (Vue never hydrates in time) AND the free Oxylabs datacenter
// proxies refuse connections (ERR_TUNNEL_CONNECTION_FAILED) when several
// sessions hit them at once. Serial (1) is the most reliable, and runs are
// infrequent enough that the extra wall-clock is fine. Override with POOL.
const DEFAULT_POOL = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolve as soon as the profile is decided: "ok" (playlist segments present)
// or "err" (tracker returned a status/error, e.g. 400/404 while its collector
// is refreshing). Returning "err" lets us fail fast and retry on another proxy
// instead of waiting out the whole timeout.
function stateOutcome() {
  const sp = window.__INITIAL_STATE__?.stats?.standardProfiles;
  if (!sp) return false;
  const prof = sp[Object.keys(sp)[0]];
  if (!prof) return false;
  if (prof.segments?.some((s) => s.type === "playlist")) return "ok";
  if (prof.status || prof.errors?.length) return "err";
  return false;
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

// Third-party ad / analytics / tracking hosts - pure bandwidth waste, never
// needed to hydrate the profile data. Blocking them (plus heavy media) cuts the
// bytes per scrape, which matters on metered proxies.
const BLOCK_HOSTS = /(google-analytics|googletagmanager|doubleclick|googlesyndication|google-adservices|adservice\.google|facebook\.(net|com)|connect\.facebook|hotjar|sentry|amplitude|segment\.(io|com)|mixpanel|scorecardresearch|quantserve|adnxs|adsystem|taboola|outbrain|criteo|pubmatic|rubiconproject|casalemedia|bidswitch|clarity\.ms|cloudflareinsights|fullstory|newrelic|nr-data)/i;
// Block heavy media + ad/analytics traffic. Keep stylesheets/scripts - blocking
// CSS stops the app from hydrating the profile data we need.
const blockAssets = (page) =>
  page.route("**/*", (route) => {
    const req = route.request();
    if (["image", "font", "media"].includes(req.resourceType())) return route.abort();
    if (BLOCK_HOSTS.test(req.url())) return route.abort();
    return route.continue();
  });

async function scrapeOnce(ctx, id) {
  const page = await ctx.newPage();
  try {
    await blockAssets(page);
    await page.goto(PROFILE(id), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    // NB: waitForFunction(fn, arg, options) - the timeout MUST be the 3rd arg.
    const handle = await page.waitForFunction(stateOutcome, null, { timeout: STATE_TIMEOUT });
    const outcome = await handle.jsonValue();
    if (outcome !== "ok") throw new Error("collector-refreshing"); // retry other proxy
    return await page.evaluate(extractInPage, PLAYLISTS); // may be null
  } finally {
    await page.close().catch(() => {});
  }
}

// Try each attempt on a DIFFERENT proxy so one flaky proxy (tunnel failure,
// transient 400, slow collector) doesn't cost us the player. startIdx staggers
// which proxy each player begins on.
async function scrapePlayer(contexts, startIdx, id) {
  let lastErr;
  const tries = Math.min(ATTEMPTS, contexts.length);
  for (let a = 0; a < tries; a++) {
    const ctx = contexts[(startIdx + a) % contexts.length];
    try {
      const d = await scrapeOnce(ctx, id);
      if (d) return d;
      lastErr = new Error("no-data");
    } catch (e) { lastErr = e; }
    if (a < tries - 1) await sleep(1500);
  }
  throw lastErr;
}

const readJson = async (f, fallback) => { try { return JSON.parse(await readFile(f, "utf8")); } catch { return fallback; } };

// Proxies (Oxylabs) from env, rotated across players to spread load and clear
// Cloudflare from trusted IPs. All values come from CI secrets, never the repo.
// Returns [null] (direct connection) when no proxy is configured.
function parseProxies() {
  const out = [];
  // Format A: PROXY_LIST - one proxy per line or comma. Accepts "host:port:user:pass",
  // "host:port" (uses PROXY_USER/PASS), or "http://user:pass@host:port". Lets us mix
  // proxies from several providers to spread bandwidth across their separate caps.
  const list = process.env.PROXY_LIST;
  if (list) {
    for (const raw of list.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)) {
      const url = raw.match(/^https?:\/\/(?:([^:@]+):([^@]+)@)?([^:/]+):(\d+)/);
      if (url) { out.push({ server: `http://${url[3]}:${url[4]}`, username: url[1], password: url[2] }); continue; }
      const p = raw.split(":");
      if (p.length >= 4) out.push({ server: `http://${p[0]}:${p[1]}`, username: p[2], password: p.slice(3).join(":") });
      else if (p.length === 2) out.push({ server: `http://${p[0]}:${p[1]}` }); // public/no-auth proxy - never attach our creds
    }
  }
  // Format B: PROXY_HOST + PROXY_PORTS (one host, many ports, shared creds) - Oxylabs setup.
  const host = process.env.PROXY_HOST, ports = process.env.PROXY_PORTS;
  if (host && ports) {
    const username = process.env.PROXY_USER, password = process.env.PROXY_PASS;
    for (const pt of ports.split(",")) out.push({ server: `http://${host}:${pt.trim()}`, username, password });
  }
  return out.length ? out : [null];
}

// Roughly how far apart runs are; used to stagger same-interval players into
// slots. Keep in sync with the cron in .github/workflows/tracker.yml.
const RUN_SPACING_MS = 20 * 60e3;

// Give each player a deterministic slot within its interval group so players that
// share a refresh interval don't all come due in the SAME run (a clump hammers the
// proxies/tracker at once and drops the hit rate). Players are ranked by a stable
// key within their interval group; the slot is that rank. Since every interval is
// a whole number of run-spacings, a player is only "due" on runs whose slot index
// matches, which spreads a group evenly across the interval and holds an exact
// refresh period once warm. Returns id -> rank.
function playerRanks(players, prio) {
  const defaultHours = prio.defaultHours ?? 12;
  const groups = new Map(); // intervalHours -> player ids
  for (const p of players) {
    const h = prio.players?.[p.id] ?? defaultHours;
    if (!groups.has(h)) groups.set(h, []);
    groups.get(h).push(p.id);
  }
  const rank = new Map();
  for (const ids of groups.values()) {
    ids.sort(); // stable, deterministic across runs
    ids.forEach((id, i) => rank.set(id, i));
  }
  return rank;
}

// choose which players to scrape this run: those due AND in this run's slot, most
// overdue first, capped at perRun. Each player has a target refresh interval in
// hours (data/priorities.json) and a slot (playerRanks) that spreads same-interval
// players across runs. Never-fetched players fill in immediately (ignore slot).
function selectDue(players, prio, state, now) {
  const defaultHours = prio.defaultHours ?? 12;
  const ranks = playerRanks(players, prio);
  const scored = players.map((p) => {
    let interval = (prio.players?.[p.id] ?? defaultHours) * 3600e3;
    interval *= prio.intervalMultiplier ?? 1; // global dial to trade freshness for proxy bandwidth
    const st = state[p.id] ?? {};
    if ((st.fails ?? 0) >= 3) interval *= 6; // back off chronically failing profiles
    const last = st.last ? Date.parse(st.last) : 0;
    const slots = Math.max(1, Math.round(interval / RUN_SPACING_MS));
    const mySlot = (ranks.get(p.id) ?? 0) % slots;
    const curSlot = Math.floor(now / RUN_SPACING_MS) % slots;
    const elapsed = now - last;
    const due = last === 0 || (elapsed >= interval && mySlot === curSlot);
    return { p, score: elapsed / interval, due };
  });
  scored.sort((a, b) => b.score - a.score);
  const perRun = process.env.LIMIT ? +process.env.LIMIT : prio.perRun ?? 10;
  // CI: only players that are due this run. LIMIT (local testing) ignores the due
  // gate and just takes the most-overdue N.
  const pool = process.env.LIMIT ? scored : scored.filter((x) => x.due);
  return pool.slice(0, perRun).map((x) => x.p);
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

  const proxies = parseProxies();
  console.log(`proxies: ${proxies[0] ? proxies.length + " (rotating)" : "none (direct)"}`);
  const browser = await chromium.launch({ headless: true });

  // one context per proxy (each keeps its own Cloudflare clearance cookie)
  const contexts = await Promise.all(
    proxies.map((proxy) => browser.newContext({ ...(proxy ? { proxy } : {}), userAgent: UA, viewport: { width: 1280, height: 800 } }))
  );

  // Worker pool pulling from a shared queue. Concurrency (POOL) is bounded so
  // pages stay responsive; each task rotates through the proxy contexts so load
  // spreads across all proxies regardless of pool size. A slow proxy slows only
  // its own tasks, not the whole run.
  const pool = process.env.POOL ? +process.env.POOL : Math.min(DEFAULT_POOL, contexts.length);
  const rows = new Array(players.length);
  let next = 0;
  async function worker() {
    while (true) {
      const idx = next++;
      if (idx >= players.length) break;
      const p = players[idx];
      const row = { id: p.id, name: p.name, team: p.team, steamId64: p.steamId64, status: "ok", playlists: null };
      try {
        row.playlists = await scrapePlayer(contexts, idx, p.steamId64);
        if (!row.playlists) row.status = "no-data";
      } catch (e) {
        row.status = `error: ${e.message.split("\n")[0].slice(0, 50)}`;
      }
      // update scheduling state:
      //  success -> fresh; no-data -> genuine miss (count toward backoff);
      //  error   -> transient (leave as-is so it stays due and retries next run)
      const prev = state[p.id] ?? {};
      if (row.playlists) state[p.id] = { last: takenAt, fails: 0 };
      else if (row.status === "no-data") state[p.id] = { last: prev.last ?? null, fails: (prev.fails ?? 0) + 1 };
      else state[p.id] = prev;

      const d2 = row.playlists?.d2;
      console.log(`  ${p.name.padEnd(14)} ${row.status.padEnd(12)} 2v2:${d2?.rating ?? "-"} (${d2?.matches ?? "-"} games)`);
      rows[idx] = row;
      await sleep(PER_PROXY_DELAY);
    }
  }
  console.log(`pool: ${pool} concurrent`);
  await Promise.all(Array.from({ length: pool }, () => worker()));

  await browser.close();

  await mkdir(join(ROOT, "data", "tracker-snapshots"), { recursive: true });
  const file = join(ROOT, "data", "tracker-snapshots", `tracker-${takenAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(file, JSON.stringify({ takenAt, rows }, null, 2));
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
  const ok = rows.filter((r) => r.playlists).length;
  console.log(`\ntracker snapshot: ${file}\n${ok}/${rows.length} scraped ok`);
}

// Run only when invoked directly (so the scheduler can be imported for tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { selectDue, playerRanks, RUN_SPACING_MS };

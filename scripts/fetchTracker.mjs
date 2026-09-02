// Collect ranked MMR and games-played per playlist from tracker.gg.
//
// tracker is Cloudflare-protected, so we drive a headless Chromium
// (playwright-extra + stealth) that clears the challenge. We do NOT load the
// profile page: the page ships an empty __INITIAL_STATE__ shell and its bundle
// then calls api.tracker.gg for the real stats, so a page load costs ~2.4 MB to
// deliver ~32 KB of JSON. Instead each context clears Cloudflare once against a
// trivial URL on the site origin, then calls that API directly from inside the
// page - same cookies, ~75x less traffic.
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
import { appendRows, countReadings } from "./trackerHistory.mjs";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";

chromium.use(stealth());

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ORIGIN = "https://rocketleague.tracker.network";
// Cheapest URL on the site origin that still yields a Cloudflare clearance
// cookie. Measured: warming on robots.txt costs ~0 MB and the API then answers
// 200, exactly as it does after a full profile load. Warming on the API host
// itself does NOT work - it answers 403 until the origin has cleared.
const WARM_URL = `${ORIGIN}/robots.txt`;
const API = (id) => `https://api.tracker.gg/api/v2/rocket-league/standard/profile/steam/${id}`;
const PLAYLISTS = { d1: "Ranked Duel 1v1", d2: "Ranked Doubles 2v2", d3: "Ranked Standard 3v3" };
const STATE_FILE = join(ROOT, "data", "tracker-state.json");
const ATTEMPTS = 5; // capped at proxy count in scrapePlayer; try every proxy before giving up
const NAV_TIMEOUT = 45000;
const API_TIMEOUT = 30000; // per-player API call; a warm profile answers in ~0.5-1.3s
const PER_PROXY_DELAY = 1000; // small gap between a worker's consecutive loads
// How many pages scrape at once. Concurrency hurts here on two fronts: it
// starves CPU (Vue never hydrates in time) AND the free Oxylabs datacenter
// proxies refuse connections (ERR_TUNNEL_CONNECTION_FAILED) when several
// sessions hit them at once. Serial (1) is the most reliable, and runs are
// infrequent enough that the extra wall-clock is fine. Override with POOL.
const DEFAULT_POOL = 5;
// Adaptive "hot" refresh: a player whose ranked game count jumps is queuing now,
// so refresh them fast (their MMR is moving) until they stop.
const HOT_THRESHOLD = 2; // new ranked games since last scrape that flags an active session
const COOL_AFTER = 2;    // consecutive scrapes with no new games before a hot player cools off
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Given a player's previous activity state and their current cumulative ranked
// match count, return the next {matches, hot, idle}. A jump of >= HOT_THRESHOLD
// flags a live session; once hot, stay hot while games keep coming and cool off
// after COOL_AFTER scrapes with no new games. Pure - unit-tested.
export function nextActivity(prev, curMatches) {
  const newGames = prev?.matches != null ? Math.max(0, curMatches - prev.matches) : 0;
  let hot = prev?.hot ?? false, idle = prev?.idle ?? 0;
  if (newGames >= HOT_THRESHOLD) { hot = true; idle = 0; }
  else if (newGames > 0) { idle = 0; } // still trickling games - hold current state
  else { idle = (prev?.idle ?? 0) + 1; if (idle >= COOL_AFTER) hot = false; }
  return { matches: curMatches, hot, idle };
}

// Pull the three ranked playlists out of an API profile payload. The API
// returns the same segment shape the page's embedded state used to carry, so
// the keys downstream (computeTrackerDeltas) are unchanged.
function pickPlaylists(json, names) {
  const segments = json?.data?.segments;
  if (!Array.isArray(segments)) return null;
  const pick = (name) => {
    const s = segments.find((x) => x.type === "playlist" && x.metadata?.name === name);
    if (!s) return null;
    return { rating: s.stats?.rating?.value ?? null, matches: s.stats?.matchesPlayed?.value ?? null, tier: s.stats?.tier?.metadata?.name ?? null };
  };
  const out = {};
  for (const [k, n] of Object.entries(names)) out[k] = pick(n);
  return out;
}

// api.tracker.gg is on the same Cloudflare edge as the site, and the app calls
// it with the site's cookies - so this has to run INSIDE the cleared page, not
// from Node. Returns the raw text so the caller can distinguish a cold profile
// (404 while the collector refreshes) from a transport failure.
async function apiFetch(page, url, timeout) {
  return page.evaluate(async ([u, ms]) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch(u, { credentials: "include", headers: { accept: "application/json" }, signal: ctl.signal });
      return { status: res.status, text: await res.text() };
    } finally {
      clearTimeout(timer);
    }
  }, [url, timeout]);
}

// Everything beyond the tracker's own hosts is waste. Measured against a real
// run: 35.5 MB of proxy traffic to collect 1.3 MB of documents - 96% went to ad
// platforms (live.primis.tech alone sent 1.1 MB per page). The API route avoids
// almost all of it, but the allowlist stays as a backstop: an unfiltered load
// pulled in enough ad JS to crash the tab outright during testing.
//
// An allowlist rather than a blocklist: chasing ad domains is endless, and a new
// one silently costs bandwidth again.
const ALLOW_HOSTS = /(^|\.)(tracker\.network|trackercdn\.com|tracker\.gg|challenges\.cloudflare\.com)$/i;

const blockAssets = (page) =>
  page.route("**/*", (route) => {
    const req = route.request();
    if (["image", "font", "media"].includes(req.resourceType())) return route.abort();
    let host;
    try { host = new URL(req.url()).hostname; } catch { return route.abort(); }
    return ALLOW_HOSTS.test(host) ? route.continue() : route.abort();
  });

// One cleared page per context, reused for every player that context handles.
// Cloudflare clearance is per-context, so warming once and holding the page open
// is what turns a run into N cheap JSON calls instead of N page loads.
const warmed = new WeakMap();

function warmPage(ctx) {
  let p = warmed.get(ctx);
  if (!p) {
    p = (async () => {
      const page = await ctx.newPage();
      await blockAssets(page);
      await page.goto(WARM_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
      return page;
    })().catch((e) => {
      warmed.delete(ctx); // let a later attempt re-warm rather than caching the failure
      throw e;
    });
    warmed.set(ctx, p);
  }
  return p;
}

async function scrapeOnce(ctx, id) {
  const page = await warmPage(ctx);
  const { status, text } = await apiFetch(page, API(id), API_TIMEOUT);
  // 404 means the collector has no warm profile for this id yet (it re-fetches
  // from the RL API in the background) - or the id is simply wrong. Both are
  // worth retrying on another proxy; a genuinely bad id stays 404 everywhere,
  // across runs.
  if (status !== 200) throw new Error(`api-${status}`);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error("api-bad-json"); }
  const data = pickPlaylists(json, PLAYLISTS); // may be null
  if (data && Object.values(data).every((v) => v == null)) throw new Error("no-playlists");
  return data;
}

// Try each attempt on a DIFFERENT proxy so one flaky proxy (tunnel failure,
// transient 400, slow collector) doesn't cost us the player. startIdx staggers
// which proxy each player begins on.
// Each context has its own cache, so every context used in a run re-downloads
// the ~865 KB tracker app bundle. Keeping the normal path inside a small
// working set means the bundle is fetched a few times per run instead of once
// per proxy; the remaining proxies stay available, but only for retries, so
// failover is unchanged while ~40% of the bandwidth disappears.
async function scrapePlayer(contexts, startIdx, id, workingSet = contexts.length) {
  let lastErr;
  const primary = Math.max(1, Math.min(workingSet, contexts.length));
  const tries = Math.min(ATTEMPTS, contexts.length);
  for (let a = 0; a < tries; a++) {
    // attempt 0 rotates within the working set; retries may use any proxy
    const ctx = a === 0
      ? contexts[startIdx % primary]
      : contexts[(startIdx + a) % contexts.length];
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
const RUN_SPACING_MS = 5 * 60e3;

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
    // Active session -> refresh fast (set/cleared in main() from the game-count delta)
    if (st.hot) interval = Math.min(interval, (prio.hotIntervalMinutes ?? 20) * 60e3);
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

  // Nothing due (common now that intervals are tripled): skip the browser +
  // proxy contexts entirely and write no snapshot, so the run is a true no-op
  // (no commit, no wasted contexts).
  if (players.length === 0) {
    console.log("no players due this run - skipping browser/scrape");
    return;
  }

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
        row.playlists = await scrapePlayer(contexts, idx, p.steamId64, pool);
        if (!row.playlists) row.status = "no-data";
      } catch (e) {
        row.status = `error: ${e.message.split("\n")[0].slice(0, 50)}`;
      }
      // update scheduling state:
      //  success -> fresh; no-data -> genuine miss (count toward backoff);
      //  error   -> transient (leave as-is so it stays due and retries next run)
      const prev = state[p.id] ?? {};
      if (row.playlists) {
        const pl = row.playlists;
        const curMatches = (pl.d1?.matches ?? 0) + (pl.d2?.matches ?? 0) + (pl.d3?.matches ?? 0);
        // Hot flag: for pros whose Steam status is visible, presenceHot owns it -
        // just carry it through. For private/undetectable pros, fall back to the
        // game-count delta so they can still go hot when their games jump.
        if (prev.presence && prev.presence !== "unknown") {
          state[p.id] = { last: takenAt, fails: 0, presence: prev.presence, matches: curMatches, hot: prev.hot ?? false, idle: prev.idle ?? 0 };
        } else {
          state[p.id] = { last: takenAt, fails: 0, presence: prev.presence, ...nextActivity(prev, curMatches) };
        }
      }
      else if (row.status === "no-data") state[p.id] = { ...prev, last: prev.last ?? null, fails: (prev.fails ?? 0) + 1 };
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

  // Fold this run into the rolling history instead of writing another snapshot
  // file. See scripts/trackerHistory.mjs: one file updated in place stays small
  // and delta-compresses, where a file per run grew the repo ~9 MB a day here.
  const HISTORY_FILE = join(ROOT, "data", "tracker-history.json");
  const takenAtMs = Date.parse(takenAt);
  const history = appendRows(await readJson(HISTORY_FILE, {}), takenAtMs, rows);
  await writeFile(HISTORY_FILE, JSON.stringify(history));
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
  const ok = rows.filter((r) => r.playlists).length;
  console.log(`\ntracker history: ${countReadings(history)} readings / ${Object.keys(history.players).length} players\n${ok}/${rows.length} scraped ok`);
}

// Run only when invoked directly (so the scheduler can be imported for tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { selectDue, playerRanks, RUN_SPACING_MS };

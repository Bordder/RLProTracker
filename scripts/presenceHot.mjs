// Flag "hot" (actively-playing) pros from Steam's live status, so the tracker
// scrapes them fast while they queue - without the bandwidth cost of scraping
// tracker.gg just to find out who's online.
//
// One batched Steam GetPlayerSummaries call (free, not proxied) tells us who is
// in Rocket League right now. In-game -> hot. Visibly-not-in-game -> cool off
// after COOL_AFTER consecutive checks. Private profiles (can't see status) are
// left untouched, so fetchTracker's game-count fallback still covers them.
//
// Runs before fetchTracker in `npm run tracker`. Needs STEAM_API_KEY; if it's
// missing the step is a no-op so the pipeline still works.
//
// Usage:  STEAM_API_KEY=xxx node scripts/presenceHot.mjs

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_FILE = join(ROOT, "data", "tracker-state.json");
const RL_APPID = "252950";
const COOL_AFTER = 2; // consecutive not-in-game checks before a hot pro cools off

// Pure transition: given a player's prior state and this check's presence
// ("in" | "out" | "unknown"), return the next state. Exported for tests.
export function nextPresence(prev, presence) {
  const st = { ...prev, presence };
  if (presence === "in") { st.hot = true; st.idle = 0; }
  // only advance the cooldown while the pro is still hot; once cold, leave idle
  // alone so a long-idle pro doesn't churn state every run.
  else if (presence === "out" && st.hot) {
    st.idle = (prev.idle ?? 0) + 1;
    if (st.idle >= COOL_AFTER) st.hot = false;
  }
  // "unknown" (private profile): leave hot/idle for the game-delta fallback
  return st;
}

// Classify a Steam summary: only public profiles (visibility 3) expose live
// game status, so anything else is "unknown".
export function classifyPresence(summary) {
  if (!summary || summary.communityvisibilitystate !== 3) return "unknown";
  return String(summary.gameid) === RL_APPID ? "in" : "out";
}

const readJson = async (f, fallback) => { try { return JSON.parse(await readFile(f, "utf8")); } catch { return fallback; } };

async function main() {
  const KEY = process.env.STEAM_API_KEY;
  if (!KEY) { console.log("presenceHot: no STEAM_API_KEY - skipping"); return; }

  const roster = await readJson(join(ROOT, "data", "roster.json"), { players: [] });
  const state = await readJson(STATE_FILE, {});
  const withId = roster.players.filter((p) => p.steamId64);
  if (!withId.length) { console.log("presenceHot: no steam ids"); return; }

  const idBySteam = new Map(withId.map((p) => [p.steamId64, p.id]));
  const presence = new Map(); // playerId -> "in"|"out"|"unknown"

  for (let i = 0; i < withId.length; i += 100) {
    const group = withId.slice(i, i + 100).map((p) => p.steamId64);
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${KEY}&steamids=${group.join(",")}`;
    let data;
    try { data = await (await fetch(url)).json(); }
    catch (e) { console.log(`presenceHot: summaries fetch failed (${e.message}) - skipping`); return; }
    for (const s of data?.response?.players ?? []) {
      const pid = idBySteam.get(s.steamid);
      if (pid) presence.set(pid, classifyPresence(s));
    }
  }

  let inGame = 0;
  const live = [];
  for (const p of withId) {
    const pres = presence.get(p.id) ?? "unknown";
    state[p.id] = nextPresence(state[p.id] ?? {}, pres);
    if (pres === "in") { inGame++; live.push(p.name); }
  }

  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`presenceHot: ${inGame} in Rocket League${live.length ? " (" + live.join(", ") + ")" : ""}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

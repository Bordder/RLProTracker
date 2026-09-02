// Fetch Rocket League Steam playtime for each rostered player.
// Free Steam Web API. Writes a timestamped snapshot to data/snapshots/.
//
// Usage:  STEAM_API_KEY=xxxx npm run fetch:steam
//
// Notes / limits:
//  - Only works if the player's Steam profile game details are PUBLIC.
//  - Only sees hours if they own/play RL on STEAM (Epic-only players show nothing).
//  - playtime_2weeks is minutes played in the last 2 weeks (Steam's own window).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { appendSteamRows } from "./steamHistory.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RL_APPID = 252950;

const KEY = process.env.STEAM_API_KEY;
if (!KEY) {
  console.error("ERROR: set STEAM_API_KEY env var. Get a free key at https://steamcommunity.com/dev/apikey");
  process.exit(1);
}

const api = (iface, method, ver, params) => {
  const qs = new URLSearchParams({ key: KEY, ...params }).toString();
  return `https://api.steampowered.com/${iface}/${method}/${ver}/?${qs}`;
};

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.replace(KEY, "***")}`);
  return res.json();
}

async function resolveVanity(vanity) {
  const data = await getJson(api("ISteamUser", "ResolveVanityURL", "v0001", { vanityurl: vanity }));
  if (data?.response?.success === 1) return data.response.steamid;
  return null;
}

async function getRlPlaytime(steamId64) {
  const data = await getJson(
    api("IPlayerService", "GetOwnedGames", "v0001", {
      steamid: steamId64,
      include_appinfo: "0",
      include_played_free_games: "1",
      "appids_filter[0]": String(RL_APPID),
    })
  );
  const game = data?.response?.games?.find((g) => g.appid === RL_APPID);
  if (!game) return { owned: false, foreverMin: null, twoWeeksMin: null };
  return {
    owned: true,
    foreverMin: game.playtime_forever ?? 0,
    twoWeeksMin: game.playtime_2weeks ?? 0,
  };
}

// batched profile visibility (1=private, 2=friends, 3=public) for all ids at once
async function getVisibility(ids) {
  const map = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const group = ids.slice(i, i + 100);
    const data = await getJson(api("ISteamUser", "GetPlayerSummaries", "v2", { steamids: group.join(",") }));
    for (const p of data?.response?.players ?? []) map.set(p.steamid, p.communityvisibilitystate);
  }
  return map;
}

// Which hours method applies, so the frontend can show an honest placeholder
// and auto-upgrade when a profile opens up.
//   public         -> Steam gives real 2wk hours now
//   hidden-details -> profile public but game list hidden; presence poll covers it
//   private        -> profile locked; only games-based estimate possible
function classify(visibility, owned, foreverMin) {
  // Steam has a setting separate from game details: "always keep my total
  // playtime private". With it on, the API still returns the game but reports
  // playtime_forever as 0 rather than omitting it, so a hidden figure is
  // indistinguishable from a real zero by shape alone. Confirmed against
  // reveal's profile, which shows exactly that setting.
  //
  // These are not the hidden-details case: a profile with game details off
  // returns no game at all, so `owned` is false there. Here the profile is
  // public, live status works, and only the total is withheld - which is why
  // presence sampling can still put a number on them.
  //
  // Publishing the zero would say "has not played" about players sitting at
  // Supersonic Legend with 19 ranked games in a day.
  if (owned && foreverMin === 0) return "playtime-hidden";
  if (owned) return "public";
  if (visibility === 3) return "hidden-details";
  if (visibility === 1 || visibility === 2) return "private";
  return "unknown";
}

async function main() {
  const roster = JSON.parse(await readFile(join(ROOT, "data", "roster.json"), "utf8"));
  const takenAt = new Date().toISOString();
  const rows = [];

  // one batched visibility lookup up front (detects private -> public flips)
  const knownIds = roster.players.map((p) => p.steamId64).filter(Boolean);
  const visMap = await getVisibility(knownIds);

  for (const p of roster.players) {
    let steamId64 = p.steamId64;
    const out = { id: p.id, name: p.name, team: p.team, steamId64: null, visibility: null, status: "unknown", foreverMin: null, twoWeeksMin: null };

    try {
      if (!steamId64 && p.vanity) steamId64 = await resolveVanity(p.vanity);
      if (!steamId64) { out.status = "no-steam-id"; rows.push(out); continue; }
      out.steamId64 = steamId64;
      out.visibility = visMap.get(steamId64) ?? null;

      const pt = await getRlPlaytime(steamId64);
      if (pt.owned) { out.foreverMin = pt.foreverMin; out.twoWeeksMin = pt.twoWeeksMin; }
      out.status = classify(out.visibility, pt.owned, pt.foreverMin);
    } catch (e) {
      out.status = `error: ${e.message}`;
    }
    rows.push(out);
  }

  // Rolling history rather than a file per run: see scripts/steamHistory.mjs.
  const HISTORY_FILE = join(ROOT, "data", "steam-history.json");
  let prevHistory = {};
  try { prevHistory = JSON.parse(await readFile(HISTORY_FILE, "utf8")); } catch {}
  const history = appendSteamRows(prevHistory, Date.parse(takenAt), rows);
  await writeFile(HISTORY_FILE, JSON.stringify(history));

  // console summary
  console.log(`steam history: ${Object.keys(history.players).length} players`);
  for (const r of rows) {
    const hrs = r.foreverMin != null ? (r.foreverMin / 60).toFixed(0) : "-";
    const tw = r.twoWeeksMin != null ? (r.twoWeeksMin / 60).toFixed(1) : "-";
    console.log(`  ${r.name.padEnd(18)} ${r.status.padEnd(18)} total:${hrs}h  2wk:${tw}h`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

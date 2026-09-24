// Every minute: which Psyonix developers have Rocket League open on Steam.
//
// The Alpha Boost page is only useful if it is live, and Steam answers in one
// request for every developer with no proxy and no browser, so this runs on
// its own job (.github/workflows/devs.yml) every minute rather than waiting on
// the tracker's two-minute run and its blocked proxies.
//
// Reads data/devs.json, data/devs-state.json (for the Steam ids behind vanity
// links; read only) and the previous data/derived/devs-steam.json. Writes
// data/derived/devs-steam.json.  Usage: STEAM_API_KEY=xxx node scripts/devsSteam.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { loadDevs, steamIdOf, steamFeed } from "./devs.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "derived", "devs-steam.json");
const readJson = async (f, fallback) => { try { return JSON.parse(await readFile(f, "utf8")); } catch { return fallback; } };

async function main() {
  const key = process.env.STEAM_API_KEY;
  if (!key) { console.error("set STEAM_API_KEY"); process.exit(1); }
  // The key is in the query string and this log is public.
  const redact = (t) => String(t).split(key).join("***");

  const devs = loadDevs(await readJson(join(ROOT, "data", "devs.json"), {}));
  const state = await readJson(join(ROOT, "data", "devs-state.json"), {});
  const prev = await readJson(OUT, null);
  const ids = devs.map((d) => steamIdOf(d, state)).filter(Boolean);
  if (!ids.length) { console.log("no Steam developers"); return; }

  let players;
  try {
    const res = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${key}&steamids=${ids.join(",")}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    players = (await res.json())?.response?.players;
  } catch (e) {
    // Leave the previous file standing: a missed minute is not "out of game".
    console.log(`Steam summaries failed (${redact(e.message ?? e)}); keeping the previous answer`);
    return;
  }

  const feed = steamFeed(devs, state, players, prev, new Date().toISOString());
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(feed) + "\n");
  const inGame = devs.filter((d) => feed.devs[d.key]?.steam === "in").map((d) => d.name ?? state[d.key]?.handle ?? d.id);
  console.log(`${ids.length} Steam developers, ${inGame.length} in Rocket League${inGame.length ? ": " + inGame.join(", ") : ""}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

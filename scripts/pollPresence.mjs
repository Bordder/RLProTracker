// One presence poll: read every rostered player's live Steam status and record
// who is currently in Rocket League. Run this on a short interval (~5 min); each
// poll credits in-game players POLL_MINUTES of playtime at that timestamp.
// Over time this reconstructs hours even for players whose game HISTORY is
// private (works for any public profile - the live game field stays visible).
//
// Appends one JSON line per poll to data/presence/log.jsonl.
//
// Usage:  STEAM_API_KEY=xxx npm run poll

import { readFile, appendFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RL_APPID = "252950";
const KEY = process.env.STEAM_API_KEY;
if (!KEY) { console.error("set STEAM_API_KEY"); process.exit(1); }

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function main() {
  const roster = JSON.parse(await readFile(join(ROOT, "data", "roster.json"), "utf8"));
  const withId = roster.players.filter((p) => p.steamId64);
  const ids = withId.map((p) => p.steamId64);

  const inGame = [];
  for (const group of chunk(ids, 100)) {
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${KEY}&steamids=${group.join(",")}`;
    const data = await (await fetch(url)).json();
    for (const p of data.response.players ?? []) {
      if (p.gameid === RL_APPID) inGame.push(p.steamid);
    }
  }

  const takenAt = new Date().toISOString();
  const idBySteam = new Map(withId.map((p) => [p.steamId64, p.id]));
  const record = { t: takenAt, inGame: inGame.map((s) => idBySteam.get(s)).filter(Boolean) };

  await mkdir(join(ROOT, "data", "presence"), { recursive: true });
  await appendFile(join(ROOT, "data", "presence", "log.jsonl"), JSON.stringify(record) + "\n");

  const names = new Map(withId.map((p) => [p.id, p.name]));
  console.log(`${takenAt}  in RL: ${record.inGame.length ? record.inGame.map((i) => names.get(i)).join(", ") : "(none)"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

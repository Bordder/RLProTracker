// One presence poll: read every rostered player's live Steam status and record
// who is currently in Rocket League. Run this on a short interval (~5 min); each
// poll credits in-game players POLL_MINUTES of playtime at that timestamp.
// Over time this reconstructs hours even for players whose game HISTORY is
// private (works for any public profile - the live game field stays visible).
//
// Appends one JSON line per poll to data/presence/log.jsonl.
//
// Usage:  STEAM_API_KEY=xxx npm run poll

import { readFile, appendFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RL_APPID = "252950";
const KEY = process.env.STEAM_API_KEY;

// Strip the API key from anything we print. Node's fetch errors can carry the
// request URL in a cause chain, and this runs in a public repo's CI.
const redact = (text) => (KEY ? text.split(KEY).join("***") : text);
if (!KEY) { console.error("set STEAM_API_KEY"); process.exit(1); }

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// The log is append-only and committed on every poll, so without pruning it grows
// forever AND git stores a fresh copy of the whole file 288 times a day.
// computePresenceHours never looks further back than 14 days, so older entries are
// dead weight. Only rewrites when there is something to drop.
const KEEP_MS = 15 * 24 * 3600e3;

export async function prune(logPath) {
  let lines;
  try { lines = (await readFile(logPath, "utf8")).split("\n").filter(Boolean); }
  catch { return; }
  const cutoff = Date.now() - KEEP_MS;
  const kept = lines.filter((l) => {
    const m = l.match(/"t":"([^"]+)"/);
    const t = m ? Date.parse(m[1]) : NaN;
    return !Number.isFinite(t) || t >= cutoff; // keep unparseable lines rather than lose data
  });
  if (kept.length === lines.length) return 0;
  await writeFile(logPath, kept.join("\n") + "\n");
  console.log(`presence log: pruned ${lines.length - kept.length} entries older than 15 days`);
  return lines.length - kept.length;
}

async function main() {
  const roster = JSON.parse(await readFile(join(ROOT, "data", "roster.json"), "utf8"));
  const withId = roster.players.filter((p) => p.steamId64);
  const ids = withId.map((p) => p.steamId64);

  const inGame = [];
  for (const group of chunk(ids, 100)) {
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${KEY}&steamids=${group.join(",")}`;
    // The key travels in the query string (Steam offers no other way), so any
    // error carrying this URL must be scrubbed before it reaches a CI log - the
    // repo is public and Actions logs are readable by anyone.
    const res = await fetch(url).catch((e) => { throw new Error(redact(String(e.message ?? e))); });
    if (!res.ok) throw new Error(`HTTP ${res.status} from GetPlayerSummaries`);
    const data = await res.json();
    for (const p of data?.response?.players ?? []) {
      if (p.gameid === RL_APPID) inGame.push(p.steamid);
    }
  }

  const takenAt = new Date().toISOString();
  const idBySteam = new Map(withId.map((p) => [p.steamId64, p.id]));
  const record = { t: takenAt, inGame: inGame.map((s) => idBySteam.get(s)).filter(Boolean) };

  await mkdir(join(ROOT, "data", "presence"), { recursive: true });
  const logPath = join(ROOT, "data", "presence", "log.jsonl");
  await appendFile(logPath, JSON.stringify(record) + "\n");
  await prune(logPath);

  const names = new Map(withId.map((p) => [p.id, p.name]));
  console.log(`${takenAt}  in RL: ${record.inGame.length ? record.inGame.map((i) => names.get(i)).join(", ") : "(none)"}`);
}

// Guarded so importing this module (for tests) does not fire a live poll.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(redact(String(e && e.stack || e))); process.exit(1); });
}

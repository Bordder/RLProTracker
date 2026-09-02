// Diagnostic: what does Steam actually tell us about the players who show no hours?
//
// The presence poller assumes a profile with hidden GAME DETAILS still reports
// what it is playing right now. Five days of polling suggests otherwise: 25 of
// 37 public players were caught in game, but only 1 of 23 hidden or private
// ones. This checks the assumption directly instead of inferring it.
//
// Prints no personal data beyond what the site already shows, and never prints
// the API key. Safe to paste the output.
//
// Usage (PowerShell):
//   $env:STEAM_API_KEY="..."; node scripts/probeVisibility.mjs

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = process.env.STEAM_API_KEY;
if (!KEY) {
  console.error("set STEAM_API_KEY first");
  process.exit(1);
}
const redact = (t) => String(t).split(KEY).join("***");

// communityvisibilitystate: 1 = private/friends-only, 3 = public.
// A profile can be public (3) while still hiding its game details, which is the
// case this whole diagnostic is about.
const VIS = { 1: "private", 2: "friends-only", 3: "public" };
const PERSONA = ["offline", "online", "busy", "away", "snooze", "looking-to-trade", "looking-to-play"];
const RL_APPID = "252950";

const roster = JSON.parse(await readFile(join(ROOT, "data", "roster.json"), "utf8"));
const steam = JSON.parse(await readFile(join(ROOT, "data", "derived", "steam-hours.json"), "utf8"));

const statusById = new Map(steam.players.map((p) => [p.id, p.status]));
const players = (roster.players ?? roster).filter((p) => p.steamId64);

const chunk = (arr, n) => arr.reduce((a, x, i) => (i % n ? a[a.length - 1].push(x) : a.push([x]), a), []);

const summaries = new Map();
for (const group of chunk(players, 100)) {
  const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${KEY}&steamids=${group.map((p) => p.steamId64).join(",")}`;
  const res = await fetch(url).catch((e) => { throw new Error(redact(e.message ?? e)); });
  if (!res.ok) throw new Error(`HTTP ${res.status} from GetPlayerSummaries`);
  const data = await res.json();
  for (const s of data?.response?.players ?? []) summaries.set(s.steamid, s);
}

const rows = players.map((p) => {
  const s = summaries.get(p.steamId64);
  return {
    name: p.name,
    ourStatus: statusById.get(p.id) ?? "?",
    returned: !!s,
    visibility: s ? (VIS[s.communityvisibilitystate] ?? s.communityvisibilitystate) : "-",
    persona: s ? (PERSONA[s.personastate] ?? s.personastate) : "-",
    // The question that matters: is the live game field present at all?
    gameidField: s ? (s.gameid !== undefined ? (s.gameid === RL_APPID ? "RL" : `app ${s.gameid}`) : "absent") : "-",
    gameExtra: s?.gameextrainfo ? "yes" : "no",
    lastLogoff: s?.lastlogoff ? new Date(s.lastlogoff * 1000).toISOString().slice(0, 16) : "hidden",
  };
});

const pad = (v, n) => String(v).padEnd(n);
console.log(pad("player", 16), pad("our status", 16), pad("visibility", 13), pad("persona", 9), pad("game field", 12), pad("extra", 6), "last logoff");
console.log("-".repeat(96));
for (const r of rows.sort((a, b) => a.ourStatus.localeCompare(b.ourStatus) || a.name.localeCompare(b.name))) {
  console.log(pad(r.name, 16), pad(r.ourStatus, 16), pad(r.visibility, 13), pad(r.persona, 9), pad(r.gameidField, 12), pad(r.gameExtra, 6), r.lastLogoff);
}

// The summary is the actual finding: whether non-public profiles ever carry a
// live game field, and whether lastlogoff (a cheap activity proxy) survives
// when playtime does not.
const groups = {};
for (const r of rows) {
  const g = (groups[r.ourStatus] ??= { n: 0, returned: 0, gameFieldPresent: 0, online: 0, logoffVisible: 0 });
  g.n++;
  if (r.returned) g.returned++;
  if (r.gameidField !== "absent" && r.gameidField !== "-") g.gameFieldPresent++;
  if (r.persona !== "offline" && r.persona !== "-") g.online++;
  if (r.lastLogoff !== "hidden") g.logoffVisible++;
}
console.log("\nsummary by our status:");
for (const [k, g] of Object.entries(groups)) {
  console.log(`  ${pad(k, 16)} players ${g.n}  api-returned ${g.returned}  in-a-game-now ${g.gameFieldPresent}  online-now ${g.online}  lastlogoff-visible ${g.logoffVisible}`);
}
console.log("\nNote: 'in-a-game-now' only counts players actually playing at this moment, so a low");
console.log("number here is only meaningful next to the public group measured at the same time.");

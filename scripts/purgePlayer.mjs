// Remove players from every store the collectors keep, for a removal request.
//
//   node scripts/purgePlayer.mjs <id> [<id>...]          say what would change
//   node scripts/purgePlayer.mjs <id> ... --apply         do it
//   node scripts/purgePlayer.mjs --not-on-roster          every id main's roster.json no longer lists
//   DATA_DIR=.databranch/data node scripts/...            act on the data worktree
//
// Taking someone off roster.json stops new readings, but it does not empty
// what is already held: tracker-history.json lets go on the next run, while
// steam-history.json keeps a player's newest reading past the retention
// limit, last-known-hours.json and peak-mmr.json never drop an entry, and the
// presence log keeps its 15 days. This clears all of them, and the per-player
// rows in derived/, so a removed player is gone from the current files at once
// rather than on the next run.
//
// What it cannot reach is the git history of the data branch, where earlier
// versions of every file stay. Removing those needs a history rewrite.
//
// Remove the player from data/teams.json (or add an override) as well, or the
// next roster refresh adds them straight back.
//
// Writes a .bak beside anything it changes.
import { readFile, writeFile, copyFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, isAbsolute } from "node:path";

/** A store keyed by player id under `players`, as most of them are. */
export function dropKeyed(doc, ids) {
  if (!doc?.players || Array.isArray(doc.players)) return doc;
  const players = Object.fromEntries(Object.entries(doc.players).filter(([id]) => !ids.has(id)));
  return { ...doc, players };
}

/** A derived feed whose `players` is a list of rows carrying an id. */
export function dropListed(doc, ids) {
  if (!Array.isArray(doc?.players)) return doc;
  return { ...doc, players: doc.players.filter((p) => !ids.has(p?.id)) };
}

/** tracker-state.json, which is keyed by id at the top level. */
export function dropTopLevel(doc, ids) {
  return Object.fromEntries(Object.entries(doc ?? {}).filter(([id]) => !ids.has(id)));
}

/** The presence log: one JSON line per poll, naming who was in game. */
export function dropFromLog(text, ids) {
  return text.split("\n").filter(Boolean).map((line) => {
    try {
      const rec = JSON.parse(line);
      if (Array.isArray(rec.inGame)) rec.inGame = rec.inGame.filter((id) => !ids.has(id));
      return JSON.stringify(rec);
    } catch {
      return line;
    }
  }).join("\n") + "\n";
}

// Every store, and how each is shaped. Paths are relative to DATA.
const STORES = [
  ["tracker-history.json", dropKeyed],
  ["tracker-state.json", dropTopLevel],
  ["peak-mmr.json", dropKeyed],
  ["steam-history.json", dropKeyed],
  ["last-known-hours.json", dropKeyed],
  ["derived/tracker.json", dropListed],
  ["derived/steam-hours.json", dropListed],
  ["derived/presence-hours.json", dropListed],
  ["derived/mmr-history.json", dropKeyed],
];
const LOG = "presence/log.jsonl";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const DATA = process.env.DATA_DIR
    ? (isAbsolute(process.env.DATA_DIR) ? process.env.DATA_DIR : join(ROOT, process.env.DATA_DIR))
    : join(ROOT, "data");
  const APPLY = process.argv.includes("--apply");
  const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
  const ids = new Set(process.argv.slice(2).filter((a) => !a.startsWith("--")));

  if (process.argv.includes("--not-on-roster")) {
    // The roster on main, which roster.yml keeps current. The data branch has
    // an old copy of roster.json that no workflow updates, and trusting it
    // would purge players who are still listed.
    const roster = new Set((await readJson(join(ROOT, "data", "roster.json"))).players.map((p) => p.id));
    for (const [file] of STORES) {
      const doc = await readJson(join(DATA, file)).catch(() => null);
      const held = !doc ? [] : file === "tracker-state.json" ? Object.keys(doc)
        : Array.isArray(doc.players) ? doc.players.map((p) => p?.id) : Object.keys(doc.players ?? {});
      for (const id of held) if (id && !roster.has(id)) ids.add(id);
    }
  }
  if (!ids.size) {
    console.error("usage: node scripts/purgePlayer.mjs <player-id> [...] [--apply], or --not-on-roster");
    process.exit(1);
  }

  console.log(`${APPLY ? "purging" : "dry run"}  ${DATA}`);
  console.log(`  ids: ${[...ids].sort().join(", ")}`);
  for (const [file, drop] of STORES) {
    const path = join(DATA, file);
    const doc = await readJson(path).catch(() => null);
    if (!doc) continue;
    const before = JSON.stringify(doc);
    const after = JSON.stringify(drop(doc, ids));
    if (before === after) continue;
    console.log(`  ${file}`);
    if (APPLY) {
      await copyFile(path, `${path}.bak`);
      await writeFile(path, after + "\n");
    }
  }
  const logPath = join(DATA, LOG);
  const log = await readFile(logPath, "utf8").catch(() => null);
  if (log != null && dropFromLog(log, ids) !== log) {
    console.log(`  ${LOG}`);
    if (APPLY) {
      await copyFile(logPath, `${logPath}.bak`);
      await writeFile(logPath, dropFromLog(log, ids));
    }
  }
  console.log(APPLY
    ? "\ndone. .bak files written beside each. Publish with scripts/publish-data.sh, and take them out of teams.json too."
    : "\nnothing written. re-run with --apply to purge.");
}

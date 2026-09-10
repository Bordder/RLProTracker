// Aggregate per-player Steam hours into per-team totals.
// Reads data/derived/steam-hours.json (from computeDeltas), groups by team.
// Writes data/derived/team-hours.json for the frontend.
//
// Usage:  npm run aggregate   (run after fetch:steam + deltas)

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const sum = (arr) => arr.reduce((a, b) => a + (b ?? 0), 0);

// The whole computation, separated from the file reading so it can be tested.
// Only players with a totalHours are summed: a team's figure is the sum of the
// members who publish, and `tracked` against `players` is what lets the board
// say so rather than printing a partial sum as if it were the whole roster.
export function teamHours(players) {
  const byTeam = new Map();
  for (const p of players) {
    // Free agents have no team, so they belong to no team total. Same reasoning
    // as teamTracker in aggregateTracker.mjs: an "Unknown" bucket would show up
    // as an org on the board.
    const team = p.team;
    if (!team) continue;
    if (!byTeam.has(team)) byTeam.set(team, []);
    byTeam.get(team).push(p);
  }

  const teams = [];
  for (const [team, roster] of byTeam) {
    const tracked = roster.filter((p) => p.totalHours != null); // public + on Steam
    teams.push({
      team,
      players: roster.length,
      tracked: tracked.length, // how many actually return Steam data
      windows: {
        d1: +sum(tracked.map((p) => p.windows?.d1?.hours)).toFixed(1),
        d7: +sum(tracked.map((p) => p.windows?.d7?.hours)).toFixed(1),
        d14: +sum(tracked.map((p) => p.windows?.d14?.hours)).toFixed(1),
      },
      steam2wkHours: +sum(tracked.map((p) => p.steam2wkHours)).toFixed(1),
      totalHours: +sum(tracked.map((p) => p.totalHours)).toFixed(0),
    });
  }

  teams.sort((a, b) => b.windows.d14 - a.windows.d14);
  return teams;
}

async function main() {
  const { players, computedAt, snapshotCount } = JSON.parse(
    await readFile(join(ROOT, "data", "derived", "steam-hours.json"), "utf8")
  );

  const teams = teamHours(players);

  await writeFile(
    join(ROOT, "data", "derived", "team-hours.json"),
    JSON.stringify({ computedAt, snapshotCount, teams }, null, 2)
  );
  console.log(`team-hours.json: ${teams.length} teams`);
  for (const t of teams.slice(0, 12)) {
    console.log(`  ${t.team.padEnd(20)} tracked ${t.tracked}/${t.players}  2wk:${t.steam2wkHours}h  d7:${t.windows.d7}h`);
  }
}

// Only run when invoked directly: importing this for its exports must not
// start reading and rewriting the derived files.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

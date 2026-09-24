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

async function main() {
  const { players, computedAt, snapshotCount } = JSON.parse(
    await readFile(join(ROOT, "data", "derived", "steam-hours.json"), "utf8")
  );

  const byTeam = new Map();
  for (const p of players) {
    const team = p.team ?? "Unknown";
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

  await writeFile(
    join(ROOT, "data", "derived", "team-hours.json"),
    JSON.stringify({ computedAt, snapshotCount, teams }, null, 2)
  );
  console.log(`team-hours.json: ${teams.length} teams`);
  for (const t of teams.slice(0, 12)) {
    console.log(`  ${t.team.padEnd(20)} tracked ${t.tracked}/${t.players}  2wk:${t.steam2wkHours}h  d7:${t.windows.d7}h`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

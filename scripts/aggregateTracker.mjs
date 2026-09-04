// Aggregate tracker data into per-team figures: average MMR per playlist and
// total ranked games played per window.
// Reads data/derived/tracker.json, writes data/derived/team-tracker.json.
//
// Usage: npm run tracker:aggregate

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WK = ["d1", "d7", "d14"];
const PL = ["ones", "twos", "threes"];

const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);

async function main() {
  const { players, computedAt, snapshotCount } = JSON.parse(
    await readFile(join(ROOT, "data", "derived", "tracker.json"), "utf8")
  );

  const byTeam = new Map();
  for (const p of players) {
    const t = p.team ?? "Unknown";
    if (!byTeam.has(t)) byTeam.set(t, []);
    byTeam.get(t).push(p);
  }

  const teams = [];
  for (const [team, roster] of byTeam) {
    const avgMmr = {};
    for (const k of PL) avgMmr[k] = avg(roster.map((p) => p.mmr?.[k]).filter((v) => v != null));

    const games = {};
    for (const w of WK) {
      // A window still filling is not a count: a player added today reports his
      // whole season as the diff, which would land in the team's total as a
      // thousand games in a day.
      const vals = roster
        .map((p) => p.games?.total?.[w])
        .filter((g) => g && g.games != null && !g.partial)
        .map((g) => g.games);
      games[w] = vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    }
    const seasonVals = roster.map((p) => p.seasonGames?.total).filter((v) => v != null);
    const seasonGames = seasonVals.length ? seasonVals.reduce((a, b) => a + b, 0) : null;

    teams.push({
      team,
      players: roster.length,
      ranked: roster.filter((p) => p.mmr?.twos != null).length,
      avgMmr,
      seasonGames,
      games,
    });
  }

  teams.sort((a, b) => (b.avgMmr.twos ?? 0) - (a.avgMmr.twos ?? 0));

  await mkdir(join(ROOT, "data", "derived"), { recursive: true });
  await writeFile(join(ROOT, "data", "derived", "team-tracker.json"), JSON.stringify({ computedAt, snapshotCount, teams }, null, 2));
  console.log(`team-tracker.json: ${teams.length} teams`);
  for (const t of teams.slice(0, 12)) {
    console.log(`  ${t.team.padEnd(20)} avg 2v2 MMR:${t.avgMmr.twos ?? "-"}  ranked ${t.ranked}/${t.players}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

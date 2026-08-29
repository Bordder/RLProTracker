// Turn the presence poll log into hours-played per 24h/7d/14d window.
// Each poll where a player was in RL credits POLL_MINUTES of playtime at that
// poll's timestamp; we sum credits falling inside each window.
//
// POLL_MINUTES should match the real polling interval. If polls are irregular,
// a credit is capped at the gap since the previous poll (avoids over-counting
// after downtime).
//
// Writes data/derived/presence-hours.json.  Usage: npm run poll:hours

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const POLL_MINUTES = 5;         // intended interval
const MAX_CREDIT_MIN = 10;      // cap per poll if gap was long (missed polls)
const MIN = 60000;
const WINDOWS = { d1: 24 * 60, d7: 7 * 24 * 60, d14: 14 * 24 * 60 };

async function main() {
  let lines;
  try { lines = (await readFile(join(ROOT, "data", "presence", "log.jsonl"), "utf8")).trim().split("\n").filter(Boolean); }
  catch { console.error("no presence log yet - run npm run poll first"); process.exit(1); }

  if (!lines.length) { console.error("presence log is empty - run npm run poll first"); process.exit(1); }
  const polls = lines.map((l) => JSON.parse(l)).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  const now = Date.parse(polls[polls.length - 1].t);

  // per player: array of {t, minutes} credits
  const credits = new Map();
  let prevT = null;
  for (const poll of polls) {
    const t = Date.parse(poll.t);
    const gapMin = prevT == null ? POLL_MINUTES : Math.min(MAX_CREDIT_MIN, (t - prevT) / MIN);
    for (const id of poll.inGame) {
      if (!credits.has(id)) credits.set(id, []);
      credits.get(id).push({ t, minutes: gapMin });
    }
    prevT = t;
  }

  const players = [];
  for (const [id, arr] of credits) {
    const windows = {};
    for (const [key, span] of Object.entries(WINDOWS)) {
      const cutoff = now - span * MIN;
      windows[key] = +(arr.filter((c) => c.t >= cutoff).reduce((a, c) => a + c.minutes, 0) / 60).toFixed(1);
    }
    players.push({ id, presenceHours: windows });
  }

  await mkdir(join(ROOT, "data", "derived"), { recursive: true });
  await writeFile(
    join(ROOT, "data", "derived", "presence-hours.json"),
    JSON.stringify({ computedAt: new Date(now).toISOString(), pollCount: polls.length, pollMinutes: POLL_MINUTES, players }, null, 2)
  );
  console.log(`presence-hours.json: ${players.length} players with tracked sessions, ${polls.length} polls`);
}

main().catch((e) => { console.error(e); process.exit(1); });

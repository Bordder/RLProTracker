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

// The whole computation, separated from the file reading so it can be tested.
// Polls are sorted here rather than assumed sorted, and every window is measured
// back from the LAST poll rather than from wall-clock now: if collection stops,
// the figures freeze at their last honest value instead of decaying towards zero
// while nothing is being measured.
export function presenceHours(polls, opts = {}) {
  const pollMinutes = opts.pollMinutes ?? POLL_MINUTES;
  const maxCredit = opts.maxCreditMin ?? MAX_CREDIT_MIN;
  const sorted = [...polls].sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  const now = Date.parse(sorted[sorted.length - 1].t);

  const credits = new Map();
  let prevT = null;
  for (const poll of sorted) {
    const t = Date.parse(poll.t);
    // Cap the credit at the real gap: after an outage a single poll would
    // otherwise claim every minute since the last one as time played.
    const gapMin = prevT == null ? pollMinutes : Math.min(maxCredit, (t - prevT) / MIN);
    for (const id of poll.inGame ?? []) {
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
  return { now, players };
}

async function main() {
  let lines;
  try { lines = (await readFile(join(ROOT, "data", "presence", "log.jsonl"), "utf8")).trim().split("\n").filter(Boolean); }
  catch { console.error("no presence log yet - run npm run poll first"); process.exit(1); }

  if (!lines.length) { console.error("presence log is empty - run npm run poll first"); process.exit(1); }
  const polls = lines.map((l) => JSON.parse(l));
  const { now, players } = presenceHours(polls);

  await mkdir(join(ROOT, "data", "derived"), { recursive: true });
  await writeFile(
    join(ROOT, "data", "derived", "presence-hours.json"),
    JSON.stringify({ computedAt: new Date(now).toISOString(), pollCount: polls.length, pollMinutes: POLL_MINUTES, players }, null, 2)
  );
  console.log(`presence-hours.json: ${players.length} players with tracked sessions, ${polls.length} polls`);
}

// Only run when invoked directly: importing this for its exports must not
// start reading the poll log and rewriting the derived file.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

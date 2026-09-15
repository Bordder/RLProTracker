// Assert the LIVE site is serving usable data, from outside it.
//
// Every other alarm reads something the pipeline produced about itself. This
// one reads what a visitor's browser actually receives, through the same
// origin, the same Pages Function and the same edge cache, which is the only
// place several real failures have ever been visible:
//
//   mmr-history.json answered 502 for a day, because the page shipped before
//   the collector that writes it - a feed can be perfectly healthy in the repo
//   and absent from the site.
//
//   bracket.json sat three hours stale during a live play-in, because nothing
//   had ever run its collector. Every other feed was green.
//
//   A bracket showed Virtus.pro as the winner of a series at 2-1, which no
//   freshness check can see: the data arrived on time and said the wrong thing.
//
// So the checks are of two kinds. Is it ARRIVING - present, parseable, recent
// enough for what it is - and is it COHERENT - do the numbers inside it
// contradict each other. The second kind is what a schema check would miss.
//
// Usage:  node scripts/smokeLive.mjs
//   env:  SITE (default https://198x.online), DISCORD_WEBHOOK, RUN_URL
//
// Exits 1 when anything fails, so the workflow goes red as well as posting.

import { postEmbed } from "./discordPost.mjs";

const SITE = process.env.SITE ?? "https://198x.online";

// How old each feed may be before it is worth saying something.
//
// The 2-minute collectors leave data about 3 minutes old at worst, so 20
// absorbs several missed runs without crying wolf - this is a backstop for a
// feed that has stopped, not a pager for one that skipped a beat.
//
// The Steam jobs are hourly, dispatched at :07, so a perfectly healthy
// steam-hours.json is routinely 50 minutes old and was reported as stale by
// the first live run of this check. A threshold shorter than a feed's own
// cadence is not a check, it is a scheduled false alarm.
const STALE_MINUTES = 20;
const HOURLY_STALE_MINUTES = 90;

// The bracket is exempt unless a LAN is being played, because between events
// it is CORRECT for it to be hours or weeks old: the collector deliberately
// fetches nothing outside an event's window, and alarming on that would teach
// everyone to ignore the channel for eleven months of the year.
const BRACKET_STALE_MINUTES = 20;

const FEEDS = [
  { file: "tracker.json", rows: "players", min: 50 },
  { file: "team-tracker.json", rows: "teams", min: 10 },
  { file: "steam-hours.json", rows: "players", min: 20, stale: HOURLY_STALE_MINUTES },
  { file: "presence-hours.json", rows: "players", min: 20 },
  // mmr-history keys its players by id rather than listing them, which is
  // why the count below is of entries and not of array length.
  { file: "mmr-history.json", rows: "players", min: 20 },
  { file: "bracket.json", rows: "events", min: 1 },
];

const minutesSince = (iso, now) => (now - Date.parse(iso)) / 60000;
const age = (m) => (m >= 90 ? `${(m / 60).toFixed(1)}h` : `${Math.round(m)}m`);

/**
 * Everything wrong with one fetched feed, as plain sentences.
 *
 * Pure, so the interesting cases can be tested without a network: a feed that
 * arrives on time and contradicts itself is the one worth catching, and it is
 * not reproducible by asking the live site nicely.
 *
 * @param feed  the FEEDS entry
 * @param doc   the parsed JSON
 * @param now   epoch ms
 */
export function auditFeed(feed, doc, now) {
  const problems = [];
  const name = feed.file;

  if (!doc || typeof doc !== "object") return [`${name}: not a JSON object`];

  // Some feeds list their rows and some key them by id. Both are "how many
  // players are in here", so both count.
  const rows = doc[feed.rows];
  const n = Array.isArray(rows) ? rows.length : rows && typeof rows === "object" ? Object.keys(rows).length : null;
  if (n === null) problems.push(`${name}: no ${feed.rows}`);
  else if (n < feed.min) problems.push(`${name}: ${n} ${feed.rows}, expected at least ${feed.min}`);

  const stamp = doc.computedAt ?? doc.generatedAt;
  if (!stamp) problems.push(`${name}: no computedAt or generatedAt`);
  else if (!Number.isFinite(Date.parse(stamp))) problems.push(`${name}: unreadable timestamp ${stamp}`);

  if (name !== "bracket.json") {
    const old = stamp ? minutesSince(stamp, now) : null;
    if (old !== null && Number.isFinite(old) && old > (feed.stale ?? STALE_MINUTES)) {
      problems.push(`${name}: ${age(old)} old`);
    }
    return problems;
  }

  return [...problems, ...auditBracket(doc, now)];
}

/** The coherence checks a stale-or-fresh test cannot make. */
export function auditBracket(doc, now) {
  const problems = [];
  const today = new Date(now).toISOString().slice(0, 10);
  const running = (doc.events ?? []).filter((e) => e.starts && e.ends && e.starts <= today && today <= e.ends);

  // Freshness, but only while it means something.
  if (running.length) {
    const old = minutesSince(doc.generatedAt, now);
    if (Number.isFinite(old) && old > BRACKET_STALE_MINUTES) {
      problems.push(`bracket.json: ${age(old)} old while ${running.map((e) => e.name ?? e.slug).join(", ")} is being played`);
    }
  }

  for (const ev of doc.events ?? []) {
    const matches = (ev.stages ?? []).flatMap((s) => [
      ...(s.brackets ?? []).flatMap((b) => b.matches ?? []),
      ...(s.matchlists ?? []).flatMap((l) => l.matches ?? []),
    ]);

    // A team still wearing a Liquipedia short code. The collector re-resolves
    // these itself now, so one surviving an hour means that is not working.
    if (ev.unresolved?.length) {
      problems.push(`${ev.slug}: unresolved team names ${ev.unresolved.join(", ")}`);
    }

    for (const m of matches) {
      const states = [m.finished, m.live, m.upcoming].filter(Boolean).length;
      if (states !== 1) {
        problems.push(`${ev.slug}: ${m.teams?.join(" vs ") ?? "a match"} is in ${states} states`);
      }
      // The 15 September bug, stated as an assertion: a series is not over
      // until one side has enough map wins to end it.
      if (m.finished && m.scores?.[0] === m.scores?.[1] && m.scores?.[0] !== null) {
        problems.push(`${ev.slug}: ${m.teams?.join(" vs ") ?? "a match"} finished ${m.scores.join("-")}, a draw`);
      }
      if (m.live && (m.scores?.[0] === null || m.scores?.[1] === null)) {
        problems.push(`${ev.slug}: ${m.teams?.join(" vs ") ?? "a match"} is live with no score`);
      }
    }

    const counted = (ev.counts?.played ?? 0) + (ev.counts?.live ?? 0) + (ev.counts?.upcoming ?? 0);
    if (ev.counts && counted !== ev.counts.matches) {
      problems.push(`${ev.slug}: counts say ${counted} of ${ev.counts.matches} matches`);
    }
  }

  return problems;
}

async function readFeed(feed) {
  // Cache-busted, because the point is what is being served now, not what an
  // edge node kept. A 502 here is the finding, not an error to retry away.
  const res = await fetch(`${SITE}/data/${feed.file}?t=${Date.now()}`, {
    headers: { "cache-control": "no-cache" },
  });
  if (!res.ok) return { problems: [`${feed.file}: HTTP ${res.status}`] };
  try {
    return { doc: await res.json() };
  } catch {
    return { problems: [`${feed.file}: body is not JSON`] };
  }
}

// Imported for auditFeed alone by the tests: nothing to fetch, nothing to post.
if (import.meta.main) {

const now = Date.now();
const problems = [];
for (const feed of FEEDS) {
  try {
    const { doc, problems: fetchProblems } = await readFeed(feed);
    if (fetchProblems) problems.push(...fetchProblems);
    else problems.push(...auditFeed(feed, doc, now));
  } catch (err) {
    // A network failure from the runner is not the same news as a broken feed,
    // and saying so stops an Actions outage being read as a dead site.
    problems.push(`${feed.file}: could not be reached (${err.message})`);
  }
}

if (!problems.length) {
  console.log(`${FEEDS.length} feeds served correctly by ${SITE}`);
  process.exit(0);
}

for (const p of problems) console.log(p);

await postEmbed({
  title: "Live data check failed",
  description: problems.map((p) => `- ${p}`).join("\n").slice(0, 3800),
  color: 0xb93b32,
  url: process.env.RUN_URL || undefined,
  footer: { text: SITE },
  timestamp: new Date(now).toISOString(),
});

process.exit(1);
}

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

// Who is asking. Cloudflare sits in front of the site and scores automated
// clients, and a request with no name from a datacenter address is the worst
// case it sees. Saying who this is costs nothing and is the polite half of
// asking not to be refused.
const UA = "rlprotracker-livecheck/1.0 (+https://198x.online)";

// Cloudflare declining to serve this client at all. It says nothing about
// whether the site is working, which is why it is counted apart from a 404 or
// a 502 - those are findings about the site itself.
const REFUSAL = new Set([403, 429]);

// Long enough to outlast the burst that triggered the refusal, short enough
// that the check still finishes well inside its job.
const RETRY_MS = 5000;

// Between one feed and the next.
const SPACING_MS = 1500;

async function fetchFeed(feed) {
  // Cache-busted, because the point is what is being served now, not what an
  // edge node kept. A 502 here is the finding, not an error to retry away.
  //
  // A THROWN fetch is a third thing again, and is reported as such: the
  // request never reached an answer, so it says as little about the site as a
  // 403 does. It is the same connection being refused, one layer down.
  let res;
  try {
    res = await fetch(`${SITE}/data/${feed.file}?t=${Date.now()}`, {
      headers: { "cache-control": "no-cache", "user-agent": UA },
    });
  } catch (err) {
    return { unreachable: true, file: feed.file, error: err.message };
  }
  if (!res.ok) return { status: res.status, ray: res.headers.get("cf-ray") };
  try {
    return { doc: await res.json() };
  } catch {
    return { problems: [`${feed.file}: body is not JSON`] };
  }
}

/**
 * One feed, with a refused request tried once more before it is believed.
 *
 * A refusal is often a single bad second rather than a state: on 16 September
 * three of six feeds answered 403 and the other three were served normally, in
 * one run, within half a second of each other. Asking again costs one request
 * and settles which of the two it was.
 */
async function readFeed(feed) {
  let res = await fetchFeed(feed);
  if (REFUSAL.has(res.status) || res.unreachable) {
    await new Promise((r) => setTimeout(r, RETRY_MS));
    res = await fetchFeed(feed);
  }
  if (res.unreachable) return res;
  if (!res.status) return res;
  return REFUSAL.has(res.status)
    ? { ...res, refused: true, file: feed.file }
    : { ...res, problems: [`${feed.file}: HTTP ${res.status}`] };
}

/**
 * What being turned away means, said once instead of per feed.
 *
 * On 15 September this check reported "tracker.json: HTTP 403" and five more
 * like it, which reads as the data being down. It was not: every feed was
 * serving correctly to browsers throughout, and what had happened was that
 * Cloudflare refused THIS CLIENT - the runner is a datacenter address, which
 * is the profile bot protection exists to stop. Naming a User-Agent did not
 * end it; on 16 September it came back for three feeds of six, which the
 * all-or-nothing version of this could not recognise at all and reported as
 * three dead feeds.
 *
 * A checker that cannot tell "the site is broken" from "I was not let in"
 * raises the wrong alarm, and the wrong alarm is worse than none.
 */
export function refusalNote(results, total) {
  const refused = results.filter((r) => r.refused);
  if (!refused.length) return null;
  const statuses = [...new Set(refused.map((r) => r.status))].sort();
  const files = refused.map((r) => r.file).filter(Boolean).join(", ");
  const ray = refused.find((r) => r.ray)?.ray;
  return `${refused.length} of ${total} feeds answered HTTP ${statuses.join("/")} to this check` +
    (files ? ` (${files})` : "") + ", twice. " +
    "This check runs from a datacenter address that Cloudflare scores, so a refusal is this client " +
    "being turned away rather than the site being down, and those feeds went unchecked. " +
    "Look at the site in a browser before treating it as an outage" + (ray ? ` (cf-ray ${ray})` : "");
}

/**
 * The feeds whose request never got an answer, said once.
 *
 * "steam-hours.json: could not be reached (fetch failed)" was posted as a
 * failure of the live data, in a run where three other feeds were refused
 * outright and two were served perfectly. A connection that dies before a
 * status code is the same news as a 403 - this client did not get in - and a
 * feed is not broken because a socket was. It is reported, because a check
 * that could not look at something should say so, but it is not a finding
 * about the site.
 */
export function unreachableNote(results, total) {
  const out = results.filter((r) => r.unreachable);
  if (!out.length) return null;
  const files = out.map((r) => r.file).filter(Boolean).join(", ");
  const why = [...new Set(out.map((r) => r.error).filter(Boolean))].join("; ");
  return `${out.length} of ${total} feeds never answered this check` +
    (files ? ` (${files})` : "") + ", twice" + (why ? `: ${why}` : "") + ". " +
    "The request failed before any status came back, so those feeds went unchecked.";
}

/**
 * What one fetched feed contributes to the failure list.
 *
 * Three outcomes, and the first one is the reason this is a function rather
 * than three lines in the loop:
 *
 *   REFUSED - nothing. The feed was never read, so there is nothing to audit.
 *   The refusal is reported once at the end, for all of them together.
 *
 *   A transport problem the fetch already described (a 502, an unparseable
 *   body) - that description.
 *
 *   Otherwise the contents, audited.
 *
 * A refusal carries neither `problems` nor `doc`, so the loop used to fall
 * through to auditFeed(feed, undefined), which answered "not a JSON object" -
 * a sentence about the site's data describing a request the site never
 * answered. It also defeated the rest of the design: a partial refusal is
 * deliberately not posted, and the invented problems made every refused run
 * look like a real failure and page the channel every hour.
 */
export function problemsFor(feed, res, now) {
  if (res.refused || res.unreachable) return [];
  if (res.problems) return res.problems;
  return auditFeed(feed, res.doc, now);
}

// Imported for auditFeed alone by the tests: nothing to fetch, nothing to post.
if (import.meta.main) {

const now = Date.now();
const problems = [];
const results = [];
for (const feed of FEEDS) {
  try {
    const res = await readFeed(feed);
    results.push(res);
    problems.push(...problemsFor(feed, res, now));
  } catch (err) {
    // A network failure from the runner is not the same news as a broken feed.
    // readFeed handles the ones it can see; anything that escapes it lands
    // here and is still counted as unchecked rather than as a dead feed.
    results.push({ unreachable: true, file: feed.file, error: err.message });
  }
  // Spaced out on purpose. Six requests to one origin inside half a second
  // from a datacenter address is the shape bot protection is looking for, and
  // this check has no reason to be in a hurry: the run is scheduled, nobody
  // is waiting on it, and a few seconds buys a request that looks less like a
  // scrape.
  if (feed !== FEEDS[FEEDS.length - 1]) await new Promise((r) => setTimeout(r, SPACING_MS));
}

const refused = refusalNote(results, FEEDS.length);
const missed = unreachableNote(results, FEEDS.length);
const notes = [refused, missed].filter(Boolean);
// Nothing was looked at. Either every feed was turned away, or none of them
// answered: both mean this run learned nothing, which is worth saying, and
// neither means the site is down.
const blind = results.every((r) => r.refused || r.unreachable);

if (!problems.length) {
  // Nothing wrong with what was served. Being turned away is only worth a
  // message when it left this check with nothing to look at: a run that was
  // refused by some feeds and found the rest healthy has PROVED the site is
  // up, and posting that every few minutes is the noise this check exists to
  // avoid.
  if (notes.length) for (const n of notes) console.log(n);
  else console.log(`${FEEDS.length} feeds served correctly by ${SITE}`);
  if (blind) {
    await postEmbed({
      title: "Live data check could not reach the site",
      description: notes.map((n) => `- ${n}`).join("\n").slice(0, 3800),
      color: 0xb98b32,
      url: process.env.RUN_URL || undefined,
      footer: { text: SITE },
      timestamp: new Date(now).toISOString(),
    });
  }
  process.exit(0);
}

// Real problems, with the refusal kept as context underneath them: what was
// not checked changes how much the list below is worth.
const lines = [...problems, ...notes];
for (const p of lines) console.log(p);

await postEmbed({
  title: "Live data check failed",
  description: lines.map((p) => `- ${p}`).join("\n").slice(0, 3800),
  color: 0xb93b32,
  url: process.env.RUN_URL || undefined,
  footer: { text: SITE },
  timestamp: new Date(now).toISOString(),
});

process.exit(1);
}

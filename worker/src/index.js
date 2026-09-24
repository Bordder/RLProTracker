// Whether a LAN is being played: see lanRunning.js for the rule and why.
import { lanRunning } from "./lanRunning.js";

// Fires the repo's collector workflows on a schedule.
//
// GitHub's cron drops most high-frequency scheduled runs on public repos (a */5
// schedule produced zero runs in 26 minutes), so the workflow_dispatch API is
// the reliable route. Two triggers:
//
//   */2  dispatches BOTH presence.yml and tracker.yml.
//
//        presence.yml - one batched Steam call, ~15s a run. Gaps undercount
//                       playtime rather than corrupt it, because the hours are
//                       credited from the real gap between polls.
//        tracker.yml  - the scrape. It takes longer than 2 minutes at the
//                       current roster, and cancel-in-progress is false, so runs
//                       QUEUE and the effective cadence is the run duration.
//                       Bandwidth is not the limit and never was: measured 4.4%
//                       of the fleet allowance. Run duration and tracker.gg's
//                       per-IP rate limiting are.
//
//   hourly (:07) dispatches steam.yml - playtime totals, and the privacy
//        classification that decides whether a row shows hours or says why not -
//        and alerts.yml, which includes the check on what the live site is
//        actually serving.
//
// Each dispatch is independent, so two workflows firing on one trigger needs no
// special handling.

// Presence and tracker now share the */2 trigger. Presence used to run every
// 5 minutes, which was also the delay before a pro who started queueing was
// noticed. That did not matter much when every player was scraped every run;
// it matters now, because idle players are deferred (idleMultiplier in
// data/priorities.json) and presence is what pulls them back to full cadence.
// Presence latency IS detection latency.
//
// Cheap to do: a presence run takes ~15s and costs two batched Steam calls,
// so 2-minute polling is 1,440 calls a day against a 100,000 limit. The real
// cost is one more commit per poll on the data branch.
//
// The hours figures are unaffected: presenceHours credits the REAL gap between
// polls, capped, rather than a fixed constant, so the cadence can change
// without making playtime wrong.
const PRESENCE_CRON = "*/2 * * * *";
const TRACKER_CRON = "*/2 * * * *";
const STEAM_CRON = "7 * * * *";
// Every minute: the Alpha Boost page's Steam check (devs.yml). One Steam
// request for about a dozen developers, no proxies, ~15s of runner time, so
// it can run twice as often as the collectors and the page stays near live.
const DEVS_CRON = "* * * * *";

// brackets.yml rides the */2 trigger for the same reason everything else does.
//
// It shipped on GitHub's own "*/5" cron and produced ZERO scheduled runs in the
// two hours and twenty minutes it was live during the Worlds play-in, which is
// how a Bo5 sat on the site at 2-1 while it was being finished. liveness.yml
// asks for */5 too and managed four runs in fifteen hours on the same day.
//
// Cadence follows the event rather than the clock: every 2 minutes on a day a
// LAN is being played, and twice an hour otherwise, so the collector is asked
// often enough to matter during a series and costs almost nothing the rest of
// the year. The collector is safe at any interval - outside an event window a
// --once run fetches nothing at all - so an extra dispatch is never harmful,
// only wasteful.
const BRACKET_FEED = "https://198x.online/data/bracket.json";

async function bracketDay(now) {
  try {
    const res = await fetch(BRACKET_FEED, { cf: { cacheTtl: 60 } });
    if (!res.ok) return false;
    return lanRunning(await res.json(), now.getTime());
  } catch {
    // Never let this decide nothing gets dispatched: on a failed read, fall
    // back to the slow cadence rather than to silence.
    return false;
  }
}

async function dispatchBracket(env, event) {
  const now = new Date(event.scheduledTime || Date.now());
  if (!(await bracketDay(now)) && now.getUTCMinutes() % 30 !== 0) return null;
  return dispatch(env, "brackets.yml");
}

async function dispatch(env, workflow) {
  // Said plainly, the way check() says it. Without this, env.GH_TOKEN.trim()
  // below threw a TypeError on every dispatch and the log held only that.
  if (!env.GH_TOKEN) {
    console.log(`${workflow} -> not dispatched: GH_TOKEN binding missing`);
    return null;
  }
  const url = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}` +
    `/actions/workflows/${workflow}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      // Trimmed: a token pasted into the dashboard or a Windows terminal often
      // carries a trailing newline, and GitHub answers a malformed auth header
      // with an empty-bodied 400 rather than a 401.
      Authorization: `Bearer ${env.GH_TOKEN.trim()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "rlprotracker-cron",
    },
    body: JSON.stringify({ ref: env.GH_REF }),
  });
  // 204 is the success code for this endpoint. A 404 here almost always means
  // the token lacks Actions write on the repo - GitHub hides existence rather
  // than returning 403.
  if (res.status !== 204) {
    console.log(`${workflow} -> ${res.status} ${await res.text()}`);
  }
  return res.status;
}

// Length-independent string compare.
//
// `a !== b` returns as soon as two bytes differ, so the time it takes leaks how
// much of a guess was right and a key can be recovered one byte at a time. Over
// the public internet that signal is buried in jitter, but the compare below
// costs nothing and removes the question.
function sameKey(a, b) {
  const x = String(a ?? "");
  const y = String(b ?? "");
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= x.charCodeAt(i % (x.length || 1)) ^ y.charCodeAt(i % (y.length || 1));
  }
  return diff === 0;
}

// Read-only health check. Deliberately says nothing about the token beyond
// whether one is bound.
//
// This makes TWO authenticated GitHub API calls per request, against the same
// GH_TOKEN budget of 5000/hour that the collectors dispatch through. It used to
// answer anybody, which made a workers.dev URL that nobody links to into a way
// to stop collection for an hour from a laptop: 2500 requests, no key, no cost
// to the caller. It is behind the run key now. The reason it was open - the
// feedback form lived here and needed to be reachable from a browser - ended
// when feedback moved to the Pages Function; the path left behind answers 410.
async function check(env, workflow) {
  if (!env.GH_TOKEN) return { workflow, error: "GH_TOKEN binding missing" };
  const url = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}` +
    `/actions/workflows/${workflow}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN.trim()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "rlprotracker-cron",
    },
  });
  // GitHub returns the token's own expiry on every authenticated response, so
  // the system can warn about it rather than relying on someone remembering a
  // date a year out. When it lapses, every collector stops at once and nothing
  // fails loudly enough to notice.
  return {
    workflow,
    status: res.status,
    tokenExpires: res.headers.get("github-authentication-token-expiration") || null,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Manual dispatch, for when Cloudflare's scheduler goes quiet.
    //
    // On 2026-09-02 the crons simply stopped firing: still registered, no
    // incident, no invocations in the tail, and a redeploy changed nothing -
    // while this same Worker answered HTTP perfectly and its token worked. So
    // execution is sound and only the scheduling is unreliable, which means an
    // outside heartbeat can stand in for it. The liveness workflow calls this
    // when the published data goes stale.
    //
    // Guarded by a shared key so the endpoint cannot be used to hammer the
    // collectors from outside.
    if (url.pathname === "/run") {
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      const key = (env.RUN_KEY || "").trim();
      if (!key) return Response.json({ error: "not-configured" }, { status: 503 });
      if (!sameKey((request.headers.get("x-run-key") || "").trim(), key)) {
        return new Response("forbidden", { status: 403 });
      }
      const wanted = url.searchParams.get("only");
      const jobs = [];
      if (!wanted || wanted === "presence") jobs.push(dispatch(env, "presence.yml"));
      if (!wanted || wanted === "tracker") jobs.push(dispatch(env, "tracker.yml"));
      if (wanted === "steam") jobs.push(dispatch(env, "steam.yml"));
      if (wanted === "brackets") jobs.push(dispatch(env, "brackets.yml"));
      if (wanted === "alerts") jobs.push(dispatch(env, "alerts.yml"));
      if (wanted === "devs") jobs.push(dispatch(env, "devs.yml"));
      const codes = await Promise.all(jobs);
      return Response.json({ dispatched: codes.length, codes });
    }

    // Feedback moved to a Pages Function on the site's own origin, where
    // Cloudflare WAF rate limiting can actually reach it. Point anything still
    // calling here at the new home rather than failing silently.
    if (url.pathname === "/feedback") {
      return Response.json({ error: "moved", endpoint: "https://198x.online/feedback" }, { status: 410 });
    }

    // Anything else is the health check. Unkeyed callers get the one fact that
    // costs nothing to produce; the GitHub reads below happen only for a caller
    // holding RUN_KEY, because each one spends the collectors' rate limit.
    const runKey = (env.RUN_KEY || "").trim();
    const authed = runKey && sameKey((request.headers.get("x-run-key") || "").trim(), runKey);
    if (!authed) {
      return Response.json(
        { ok: true, tokenPresent: Boolean(env.GH_TOKEN) },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const results = await Promise.all([
      check(env, "presence.yml"),
      check(env, "tracker.yml"),
    ]);
    const expiry = results.map((r) => r.tokenExpires).find(Boolean) || null;
    const daysLeft = expiry
      ? Math.round((Date.parse(expiry.replace(" UTC", "Z").replace(" ", "T")) - Date.now()) / 86400e3)
      : null;
    return Response.json({
      ok: results.every((r) => r.status === 200),
      tokenExpires: expiry,
      tokenDaysLeft: Number.isFinite(daysLeft) ? daysLeft : null,
      tokenPresent: Boolean(env.GH_TOKEN),
      owner: env.GH_OWNER,
      repo: env.GH_REPO,
      ref: env.GH_REF,
      results,
    }, { headers: { "cache-control": "no-store" } });
  },

  async scheduled(event, env, ctx) {
    const jobs = [];
    // Separate ifs, not else-if: presence and tracker share the */2 cron, so one
    // trigger must dispatch both. Each dispatch is independent.
    if (event.cron === PRESENCE_CRON) jobs.push(dispatch(env, "presence.yml"));
    if (event.cron === TRACKER_CRON) jobs.push(dispatch(env, "tracker.yml"));
    if (event.cron === TRACKER_CRON) jobs.push(dispatchBracket(env, event));
    if (event.cron === STEAM_CRON) jobs.push(dispatch(env, "steam.yml"));
    if (event.cron === DEVS_CRON) jobs.push(dispatch(env, "devs.yml"));
    // alerts.yml asks for "23 * * * *" and GitHub gives it a few runs a day,
    // which is not a watchdog. It rides the hourly tick for the same reason
    // every collector does.
    if (event.cron === STEAM_CRON) jobs.push(dispatch(env, "alerts.yml"));
    // A cron we do not recognise means wrangler.toml and this file disagree;
    // fall back to presence so the cheap collector keeps running either way.
    if (!jobs.length) jobs.push(dispatch(env, "presence.yml"));
    ctx.waitUntil(Promise.all(jobs));
  },
};

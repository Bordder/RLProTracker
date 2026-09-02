// Fires the repo's collector workflows on a schedule.
//
// GitHub's cron drops most high-frequency scheduled runs on public repos (a */5
// schedule produced zero runs in 26 minutes), so the workflow_dispatch API is
// the reliable route. This Worker ticks every 5 minutes and dispatches:
//
//   presence.yml - the */5 schedule. One batched Steam call; cheap, and gaps in
//                  it undercount playtime rather than corrupt it.
//   steam.yml    - hourly. Playtime totals, and the privacy classification that
//                  decides whether a row shows hours or says why it cannot.
//   tracker.yml  - the */3 schedule. Since the scraper reads the stats API
//                  instead of loading profile pages, a full 60-player run costs
//                  ~2 MB, so 3-minute polling is ~28 GB/month against a 250 GB
//                  allowance. The limit here is run duration, not bandwidth.
//
// Both crons fire together every 15 minutes; each dispatch is independent, so
// that needs no special handling.

const PRESENCE_CRON = "*/5 * * * *";
const TRACKER_CRON = "*/3 * * * *";
const STEAM_CRON = "7 * * * *";

async function dispatch(env, workflow) {
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

// Read-only health check. Deliberately says nothing about the token beyond
// whether one is bound - this URL is public once Cloudflare Access is removed
// so the feedback endpoint can be reached from a browser.
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
  return { workflow, status: res.status };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Feedback moved to a Pages Function on the site's own origin, where
    // Cloudflare WAF rate limiting can actually reach it. Point anything still
    // calling here at the new home rather than failing silently.
    if (url.pathname === "/feedback") {
      return Response.json({ error: "moved", endpoint: "https://198x.online/feedback" }, { status: 410 });
    }

    const results = await Promise.all([
      check(env, "presence.yml"),
      check(env, "tracker.yml"),
    ]);
    return Response.json({
      ok: results.every((r) => r.status === 200),
      tokenPresent: Boolean(env.GH_TOKEN),
      owner: env.GH_OWNER,
      repo: env.GH_REPO,
      ref: env.GH_REF,
      results,
    }, { headers: { "cache-control": "no-store" } });
  },

  async scheduled(event, env, ctx) {
    const jobs = [];
    if (event.cron === PRESENCE_CRON) jobs.push(dispatch(env, "presence.yml"));
    if (event.cron === TRACKER_CRON) jobs.push(dispatch(env, "tracker.yml"));
    if (event.cron === STEAM_CRON) jobs.push(dispatch(env, "steam.yml"));
    // A cron we do not recognise means wrangler.toml and this file disagree;
    // fall back to presence so the cheap collector keeps running either way.
    if (!jobs.length) jobs.push(dispatch(env, "presence.yml"));
    ctx.waitUntil(Promise.all(jobs));
  },
};

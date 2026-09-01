// Fires the repo's collector workflows on a schedule.
//
// GitHub's cron drops most high-frequency scheduled runs on public repos (a */5
// schedule produced zero runs in 26 minutes), so the workflow_dispatch API is
// the reliable route. This Worker ticks every 5 minutes and dispatches:
//
//   presence.yml - every tick. One batched Steam call; cheap, and gaps in it
//                  undercount playtime rather than corrupt it.
//   tracker.yml  - every 4th tick (20 min). Proxied headless browser scrape,
//                  far more expensive, and the scheduler inside it only
//                  releases a slice of players per run anyway.

const TRACKER_EVERY_MS = 20 * 60 * 1000;
const TICK_MS = 5 * 60 * 1000;

async function dispatch(env, workflow) {
  const url = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}` +
    `/actions/workflows/${workflow}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN}`,
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

// True when this tick crosses a new 20-minute boundary, so tracker fires once
// per boundary even if a tick is delayed or replayed.
function trackerDue(scheduledTime) {
  return Math.floor(scheduledTime / TRACKER_EVERY_MS) !==
    Math.floor((scheduledTime - TICK_MS) / TRACKER_EVERY_MS);
}


// Read-only health check, served at the Worker's URL. Reports whether the token
// binding exists and whether GitHub accepts it for this repo, using a GET
// against the workflow - it starts nothing, so exposing it publicly is safe.
async function check(env, workflow) {
  if (!env.GH_TOKEN) return { workflow, error: "GH_TOKEN binding missing" };
  const url = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}` +
    `/actions/workflows/${workflow}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "rlprotracker-cron",
    },
  });
  const body = await res.text();
  return { workflow, status: res.status, body: body.slice(0, 300) };
}

export default {
  async fetch(request, env) {
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
    const jobs = [dispatch(env, "presence.yml")];
    if (trackerDue(event.scheduledTime)) {
      jobs.push(dispatch(env, "tracker.yml"));
    }
    ctx.waitUntil(Promise.all(jobs));
  },
};

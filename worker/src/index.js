// Fires the repo's collector workflows on a schedule.
//
// GitHub's cron drops most high-frequency scheduled runs on public repos (a */5
// schedule produced zero runs in 26 minutes), so the workflow_dispatch API is
// the reliable route. This Worker ticks every 5 minutes and dispatches:
//
//   presence.yml - the */5 schedule. One batched Steam call; cheap, and gaps in
//                  it undercount playtime rather than corrupt it.
//   tracker.yml  - the */3 schedule. Since the scraper reads the stats API
//                  instead of loading profile pages, a full 60-player run costs
//                  ~2 MB, so 3-minute polling is ~28 GB/month against a 250 GB
//                  allowance. The limit here is run duration, not bandwidth.
//
// Both crons fire together every 15 minutes; each dispatch is independent, so
// that needs no special handling.

const PRESENCE_CRON = "*/5 * * * *";
const TRACKER_CRON = "*/3 * * * *";

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

// ---- feedback relay ----------------------------------------------------
//
// The site is static, so it cannot hold a GitHub token: anything shipped to the
// browser would let anyone file issues on the repo. The form posts here instead
// and the token stays server-side. Requires Issues: write on the PAT, which is
// a separate permission from the Actions one the cron needs.

const MAX_MESSAGE = 2000;
const MAX_USER = 60;
const TYPES = ["Feedback", "Feature request", "Bug", "Other"];

// Only the site may call this from a browser. SITE_ORIGINS is a comma-separated
// list in wrangler.toml; a request from any other origin gets no CORS headers,
// so the browser refuses to read the response.
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.SITE_ORIGINS || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

async function handleFeedback(request, env) {
  let payload;
  try { payload = await request.json(); } catch { return { status: 400, body: { error: "bad-json" } }; }

  // Honeypot: a real user never fills a hidden field. Answer 200 so a bot cannot
  // tell it was rejected, but file nothing.
  if (payload.hp) return { status: 200, body: { ok: true } };

  const message = String(payload.message ?? "").trim().slice(0, MAX_MESSAGE);
  const user = String(payload.user ?? "").trim().slice(0, MAX_USER);
  const type = TYPES.includes(payload.type) ? payload.type : "Feedback";
  if (!message) return { status: 400, body: { error: "empty-message" } };

  const firstLine = message.split("\n")[0].slice(0, 60);
  const title = `${type}${user ? ` from ${user}` : ""}: ${firstLine}`;
  const body = [
    message,
    "",
    "---",
    `Type: ${type}`,
    `From: ${user || "anonymous"}`,
    `Country: ${request.headers.get("cf-ipcountry") || "??"}`,
    "Via: RL Pro Tracker feedback form",
  ].join("\n");

  const res = await fetch(`https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN.trim()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "rlprotracker-cron",
      "content-type": "application/json",
    },
    body: JSON.stringify({ title, body, labels: ["feedback"] }),
  });
  if (res.status !== 201) {
    // 403 here usually means the PAT lacks Issues: write.
    console.log(`feedback -> ${res.status} ${(await res.text()).slice(0, 200)}`);
    return { status: 502, body: { error: "upstream" } };
  }
  return { status: 200, body: { ok: true } };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/feedback") {
      const cors = corsHeaders(request, env);
      if (request.method === "OPTIONS") return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      if (!cors) return new Response("forbidden origin", { status: 403 });
      const { status, body } = await handleFeedback(request, env);
      return Response.json(body, { status, headers: { ...cors, "cache-control": "no-store" } });
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
    // A cron we do not recognise means wrangler.toml and this file disagree;
    // fall back to presence so the cheap collector keeps running either way.
    if (!jobs.length) jobs.push(dispatch(env, "presence.yml"));
    ctx.waitUntil(Promise.all(jobs));
  },
};

// Feedback relay.
//
// The site is static, so it cannot hold a GitHub token: anything shipped to the
// browser would let anyone file issues on the repo. This runs server-side and
// files the issue with a token that never leaves Cloudflare.
//
// It lives on the site's own origin rather than the cron Worker for three
// reasons: Cloudflare WAF rate-limiting rules apply to this zone but not to
// workers.dev, so abuse can actually be throttled; same-origin means an ad
// blocker cannot cut it off the way one cut off the page script; and the CSP no
// longer needs to allow a third-party host.
//
// Needs GH_TOKEN (fine-grained PAT with Issues: write) as a Pages secret:
//   npx wrangler pages secret put GH_TOKEN --project-name=rlprotracker

const OWNER = "Bordder";
const REPO = "RLProTracker";
const MAX_MESSAGE = 2000;
const MAX_USER = 60;
const TYPES = ["Feedback", "Feature request", "Bug", "Other"];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

async function handlePost(context) {
  const { request, env } = context;
  if (!env.GH_TOKEN) return json({ error: "not-configured" }, 503);

  let payload;
  try { payload = await request.json(); } catch { return json({ error: "bad-json" }, 400); }

  // Honeypot: a real person never fills a hidden field. Answer 200 so a bot
  // cannot tell it was rejected, but file nothing.
  if (payload.hp) return json({ ok: true });

  const message = String(payload.message ?? "").trim().slice(0, MAX_MESSAGE);
  const user = String(payload.user ?? "").trim().slice(0, MAX_USER);
  const type = TYPES.includes(payload.type) ? payload.type : "Feedback";
  if (!message) return json({ error: "empty-message" }, 400);

  const title = `${type}${user ? ` from ${user}` : ""}: ${message.split("\n")[0].slice(0, 60)}`;
  const body = [
    message,
    "",
    "---",
    `Type: ${type}`,
    `From: ${user || "anonymous"}`,
    "Via: RL Pro Tracker feedback form",
  ].join("\n");

  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN.trim()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "rlprotracker-site",
      "content-type": "application/json",
    },
    body: JSON.stringify({ title, body, labels: ["feedback"] }),
  });
  if (res.status !== 201) {
    // 403 here usually means the token lacks Issues: write.
    console.log(`feedback -> ${res.status}`);
    return json({ error: "upstream" }, 502);
  }
  return json({ ok: true });
}

// One entry point rather than onRequest plus onRequestPost: exporting both makes
// precedence between them ambiguous, and a wrong guess would route POSTs into
// the middleware path.
export async function onRequest(context) {
  if (context.request.method !== "POST") return new Response("method not allowed", { status: 405 });
  return handlePost(context);
}

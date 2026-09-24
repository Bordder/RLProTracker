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
// A ceiling and a floor on the message. The form enforces both, but the form is
// not the only thing that can post here, so these are the ones that count.
//
// 500 rather than 2000: a symptom, a device and a repro step fit inside it, and
// it bounds what an abusive body costs to parse. 25: enough to turn away "gg"
// and "nice site", not enough to reject a real report, the shortest useful ones
// running around 35 characters.
const MAX_MESSAGE = 500;
const MIN_MESSAGE = 25;
const MAX_USER = 60;
const TYPES = ["Feedback", "Feature request", "Bug", "Other"];
// The largest body the form can send is well under 4KB: the message and name
// at their limits, every character escaped. Anything bigger is not a
// submission, and is turned away before it is parsed.
const MAX_BODY = 8 * 1024;

// One submission per address per minute.
//
// The WAF rule on this zone counts requests and is the real throttle, but it is
// tuned for a page load: 100 in 10 seconds, which is generous traffic for a
// board and a hundred GitHub issues for this endpoint. This is the endpoint's
// own floor, and it is cheap - a cache entry per submitter, no storage, no
// binding.
//
// caches.default is per-colo and has no atomic increment, so two requests that
// arrive together can both pass, and a caller who moves between colos gets a
// fresh allowance. That is fine: this exists to stop a loop, not a botnet, and
// the WAF is what stands behind it.
const SUBMIT_COOLDOWN = 60;

const cooldownKey = (request) => {
  const ip = request.headers.get("cf-connecting-ip") || "";
  if (!ip) return null;
  // The key must be a URL on this origin for the cache API to accept it, and
  // must never collide with a real path. /__fb/ is not routed.
  return new Request(new URL(`/__fb/${encodeURIComponent(ip)}`, request.url).toString(), { method: "GET" });
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// A GitHub mention inside a message, with a zero-width space after the @ so it
// reads the same and notifies nobody. Without it anybody could use this form
// to ping any GitHub user through an issue on this repo.
const noMention = (s) => s.replace(/@(?=[A-Za-z0-9])/g, "@\u200b");

async function handlePost(context) {
  const { request, env } = context;
  if (!env.GH_TOKEN) return json({ error: "not-configured" }, 503);

  // Only this site's own pages. request.json() parses whatever the content
  // type, and a text/plain POST needs no CORS preflight, so any other site
  // could make its visitors file issues here. A browser always sends Origin
  // on a POST; a caller without one is not a browser being used by a page.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "forbidden" }, 403);

  // The declared length first, so an oversized upload is refused without
  // being read, then the real one, since a chunked body declares none.
  if (Number(request.headers.get("content-length")) > MAX_BODY) return json({ error: "too-large" }, 413);
  let payload;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ error: "too-large" }, 413);
    payload = JSON.parse(text);
  } catch { return json({ error: "bad-json" }, 400); }
  // Valid JSON is not necessarily an object: null, a number or a string got
  // past the parse and then threw on payload.hp, which answered 500.
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return json({ error: "bad-json" }, 400);

  // Honeypot: a real person never fills a hidden field. Answer 200 so a bot
  // cannot tell it was rejected, but file nothing.
  if (payload.hp) return json({ ok: true });

  const message = noMention(String(payload.message ?? "").trim().slice(0, MAX_MESSAGE));
  // One line, as the form's single-line input gives it: the name goes into the
  // issue title, and a line break there would split it.
  const user = noMention(String(payload.user ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_USER));
  const type = TYPES.includes(payload.type) ? payload.type : "Feedback";
  if (!message) return json({ error: "empty-message" }, 400);
  if (message.length < MIN_MESSAGE) return json({ error: "too-short", min: MIN_MESSAGE }, 400);

  // Checked after validation so a malformed body cannot burn the allowance,
  // and before the GitHub call so a flood costs a cache read rather than an
  // issue.
  const key = cooldownKey(request);
  if (key && (await caches.default.match(key))) {
    return json({ error: "too-many", retryAfter: SUBMIT_COOLDOWN }, 429);
  }

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
  // Only a submission that actually filed something starts the clock, so a
  // failed upstream does not lock the person out of retrying.
  if (key) {
    const mark = new Response("1", { headers: { "cache-control": `public, max-age=${SUBMIT_COOLDOWN}` } });
    if (typeof context.waitUntil === "function") context.waitUntil(caches.default.put(key, mark));
    else await caches.default.put(key, mark);
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

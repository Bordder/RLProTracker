// Tiny freshness probe for open tabs.
//
// The page loads its data once. Without something to poll, a tab left open
// cannot tell the difference between "collection has stopped" and "I have been
// sitting here for an hour" - and the first reading is the alarming one, so it
// would cry wolf at anyone who leaves the site open.
//
// This returns just the collection timestamp, so a poll costs a few bytes
// instead of re-downloading the whole board.

// Served at /api/status. It used to be /status, but that path now belongs to
// the human-readable status page; a static status.html is served at /status by
// Pages' extensionless routing, which would collide with this Function.
//
// Freshness probe for open tabs. Reads through the GitHub API rather than
// raw.githubusercontent.com: raw's CDN ignores query strings, so the cache
// buster this used to rely on did nothing and this endpoint sat up to six
// minutes behind the collectors.
// The `data` branch, not main: collector output moved there so main keeps a
// history of code changes only.
const API_URL = "https://api.github.com/repos/Bordder/RLProTracker/contents/data/derived/tracker.json?ref=data";
const RAW_URL = "https://raw.githubusercontent.com/Bordder/RLProTracker/data/data/derived/tracker.json";

async function fetchTracker(env) {
  const headers = {
    Accept: "application/vnd.github.raw",
    "User-Agent": "rlprotracker-site",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (env && env.GH_TOKEN) headers.Authorization = `Bearer ${env.GH_TOKEN.trim()}`;
  const res = await fetch(API_URL, { headers, cf: { cacheTtl: 20 } });
  if (res.ok) return res;
  return fetch(RAW_URL, { cf: { cacheTtl: 30 }, headers: { "User-Agent": "rlprotracker-site" } });
}

// How long one upstream read is shared by every tab polling this colo.
//
// Without it each poll is its own API call: an authenticated response carries
// Cache-Control: private and Cloudflare never caches a subrequest that has an
// Authorization header. Every open tab polls this once a minute, and GH_TOKEN's
// 5000/hour budget is the same one the collectors dispatch through, so an
// uncollapsed probe would let ordinary traffic halt collection.
const HOT_TTL = 20;

// Only this site may read the feed from a page.
//
// Pages answers with Access-Control-Allow-Origin: * by default, so any
// site could pull these numbers straight into its own page and run on this
// collector's bandwidth. The board itself is same-origin and needs no CORS
// header at all; naming the origin keeps that working and stops the rest.
const ALLOW_ORIGIN = "https://198x.online";
const withCors = (res) => {
  const r = new Response(res.body, res);
  r.headers.set("access-control-allow-origin", ALLOW_ORIGIN);
  r.headers.set("vary", "Origin");
  return r;
};

export async function onRequestGet(context) {
  const request = context && context.request;
  const cache = caches.default;
  const hotKey = request
    ? new Request(new URL("/__hot/status", request.url).toString(), { method: "GET" })
    : null;

  if (hotKey) {
    const hot = await cache.match(hotKey);
    if (hot) return withCors(hot);
  }

  try {
    const res = await fetchTracker(context && context.env);
    if (!res.ok) return withCors(Response.json({ error: "upstream" }, { status: 502 }));
    const { computedAt } = await res.json();
    const body = { computedAt: computedAt ?? null };
    const headers = { "cache-control": `public, max-age=20, s-maxage=${HOT_TTL}` };
    if (hotKey && typeof context.waitUntil === "function") {
      context.waitUntil(cache.put(hotKey, Response.json(body, { headers })));
    }
    return withCors(Response.json(body, { headers }));
  } catch {
    return withCors(Response.json({ error: "upstream" }, { status: 502 }));
  }
}
// Pages routes by exported handler name, so exporting onRequestGet alone leaves
// HEAD to fall through to the static 404 page: curl -I on this endpoint reported
// 404 while a GET reported 200. Browsers never notice, but an uptime monitor or
// a link checker probing with HEAD reads the feed as down. HEAD must return the
// GET headers with no body, which is exactly a null-bodied copy of the response.
export async function onRequestHead(context) {
  const res = await onRequestGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}


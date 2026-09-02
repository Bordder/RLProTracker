// Same-origin proxy for the collector's JSON.
//
// The page used to fetch data straight from raw.githubusercontent.com. Two
// problems with that: raw sends Cache-Control: max-age=300, so a 3-minute
// collector was delivering data up to five minutes stale no matter what the
// page asked for; and a third-party host is one more thing an ad blocker or a
// filtered network can refuse, which empties the table with no useful error.
//
// Serving it from the site's own origin fixes both. We keep a copy in the edge
// cache and, if GitHub rate-limits or hiccups, serve that copy rather than
// failing: slightly old numbers beat "Failed to load data".

// Data is read through the GitHub API, not raw.githubusercontent.com.
//
// raw is served from a CDN that ignores query strings, so the cache buster this
// used to rely on did nothing: measured on 2026-09-02, raw held 20:21 while this
// endpoint returned 20:15, six minutes behind, with the collectors running
// perfectly every three minutes. The API's contents endpoint honours our
// no-store and, when a token is present, is not shared with anonymous callers
// at all.
const API_BASE = "https://api.github.com/repos/Bordder/RLProTracker/contents/data/derived";
const RAW_BASE = "https://raw.githubusercontent.com/Bordder/RLProTracker/main/data/derived";

async function fetchDerived(file, env) {
  const headers = {
    Accept: "application/vnd.github.raw",
    "User-Agent": "rlprotracker-site",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (env && env.GH_TOKEN) headers.Authorization = `Bearer ${env.GH_TOKEN.trim()}`;
  const res = await fetch(`${API_BASE}/${file}?ref=main`, { headers, cf: { cacheTtl: 20 } });
  if (res.ok) return { res, from: "github-api" };
  // The API can rate limit an unauthenticated caller; raw is stale but better
  // than nothing, so it stays as the fallback rather than the default.
  const raw = await fetch(`${RAW_BASE}/${file}`, {
    cf: { cacheTtl: 30 },
    headers: { "User-Agent": "rlprotracker-site" },
  });
  return { res: raw, from: "raw-fallback" };
}

const ALLOWED = /^[a-z0-9-]+\.json$/i;

// How long one upstream read is shared by every visitor hitting this colo.
//
// This is a rate-limit guard, not a speed tweak. An authenticated API response
// carries Cache-Control: private and a subrequest with an Authorization header
// is never cached by Cloudflare, so without this every single visitor request
// would be its own API call. GH_TOKEN's 5000/hour is shared with the
// workflow_dispatch calls that drive the collectors, so enough traffic here
// would stop collection entirely and drop the site back to stale raw reads.
const HOT_TTL = 20;

export async function onRequestGet(context) {
  const { request, params, waitUntil } = context;
  const file = (params.path || []).join("/");
  // Only ever proxy the derived JSON: no path traversal, no fetching arbitrary
  // repo contents through the site's origin.
  if (!ALLOWED.test(file)) return new Response("not found", { status: 404 });

  const cache = caches.default;
  const cacheKey = new Request(new URL(`/__data/${file}`, request.url).toString(), { method: "GET" });
  const hotKey = new Request(new URL(`/__hot/${file}`, request.url).toString(), { method: "GET" });

  const hot = await cache.match(hotKey);
  if (hot) return hot;

  let upstream = null;
  try {
    upstream = await fetchDerived(file, context.env);
  } catch {
    upstream = null; // network failure - fall through to the cached copy
  }

  if (upstream && upstream.res.ok) {
    const body = await upstream.res.arrayBuffer();
    const fresh = () => new Response(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        // Browsers revalidate quickly; the edge absorbs the repeat traffic.
        "cache-control": `public, max-age=30, s-maxage=${HOT_TTL}`,
        "x-proxied-from": upstream.from,
      },
    });
    // Keep a long-lived copy purely as a fallback. It is only ever read when
    // upstream fails, so its age does not affect normal serving.
    const backup = new Response(body, {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=86400" },
    });
    waitUntil(cache.put(cacheKey, backup));
    waitUntil(cache.put(hotKey, fresh()));
    return fresh();
  }

  const stale = await cache.match(cacheKey);
  if (stale) {
    const headers = new Headers(stale.headers);
    headers.set("cache-control", "public, max-age=15");
    // Says plainly that this is a fallback, so a confusing number on the page
    // can be traced without guessing.
    headers.set("x-data-stale", "upstream-unavailable");
    return new Response(stale.body, { headers });
  }

  return new Response("upstream error", { status: 502 });
}

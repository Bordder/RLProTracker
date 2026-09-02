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

const REPO_BASE = "https://raw.githubusercontent.com/Bordder/RLProTracker/main/data/derived";
const ALLOWED = /^[a-z0-9-]+\.json$/i;
const EDGE_TTL = 60;

// Upstream is fetched with a per-bucket cache buster.
//
// Asking for cacheTtl alone was not enough: on 2026-09-02 raw was serving a
// timestamp of 17:57 while this endpoint returned 17:33, a 24 minute gap, which
// made the site report that collection had stalled when the collectors were
// running perfectly. A fixed upstream URL can sit in Cloudflare's cache, and in
// GitHub's, for far longer than the TTL we ask for; changing the URL every
// bucket gives both a key they have never seen.
const BUCKET_MS = 30e3;
const bust = () => `?t=${Math.floor(Date.now() / BUCKET_MS)}`;


export async function onRequestGet(context) {
  const { request, params, waitUntil } = context;
  const file = (params.path || []).join("/");
  // Only ever proxy the derived JSON: no path traversal, no fetching arbitrary
  // repo contents through the site's origin.
  if (!ALLOWED.test(file)) return new Response("not found", { status: 404 });

  const cache = caches.default;
  const cacheKey = new Request(new URL(`/__data/${file}`, request.url).toString(), { method: "GET" });

  let upstream = null;
  try {
    upstream = await fetch(`${REPO_BASE}/${file}${bust()}`, {
      cf: { cacheTtl: EDGE_TTL, cacheEverything: true },
      headers: { "User-Agent": "rlprotracker-site" },
    });
  } catch {
    upstream = null; // network failure - fall through to the cached copy
  }

  if (upstream && upstream.ok) {
    const body = await upstream.arrayBuffer();
    const fresh = () => new Response(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        // Browsers revalidate quickly; the edge absorbs the repeat traffic.
        "cache-control": `public, max-age=30, s-maxage=${EDGE_TTL}`,
        "x-proxied-from": "raw.githubusercontent.com",
      },
    });
    // Keep a long-lived copy purely as a fallback. It is only ever read when
    // upstream fails, so its age does not affect normal serving.
    const backup = new Response(body, {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=86400" },
    });
    waitUntil(cache.put(cacheKey, backup));
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

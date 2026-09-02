// Same-origin proxy for the collector's JSON.
//
// The page used to fetch data straight from raw.githubusercontent.com. Two
// problems with that: raw sends Cache-Control: max-age=300, so a 3-minute
// collector was delivering data up to five minutes stale no matter what the
// page asked for; and a third-party host is one more thing an ad blocker or a
// filtered network can refuse, which empties the table with no useful error.
//
// Serving it from the site's own origin fixes both. We cache for 60s at the
// edge, so the origin fetch happens at most once a minute per colo while
// visitors always see something under a minute old.

const REPO_BASE = "https://raw.githubusercontent.com/Bordder/RLProTracker/main/data/derived";
const ALLOWED = /^[a-z0-9-]+\.json$/i;
const EDGE_TTL = 60;

export async function onRequestGet(context) {
  const file = (context.params.path || []).join("/");
  // Only ever proxy the derived JSON: no path traversal, no fetching arbitrary
  // repo contents through the site's origin.
  if (!ALLOWED.test(file)) return new Response("not found", { status: 404 });

  const upstream = await fetch(`${REPO_BASE}/${file}`, {
    cf: { cacheTtl: EDGE_TTL, cacheEverything: true },
    headers: { "User-Agent": "rlprotracker-site" },
  });
  if (!upstream.ok) return new Response("upstream error", { status: 502 });

  return new Response(upstream.body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Browsers revalidate quickly; the edge absorbs the repeat traffic.
      "cache-control": `public, max-age=30, s-maxage=${EDGE_TTL}`,
      "x-proxied-from": "raw.githubusercontent.com",
    },
  });
}

// Tiny freshness probe for open tabs.
//
// The page loads its data once. Without something to poll, a tab left open
// cannot tell the difference between "collection has stopped" and "I have been
// sitting here for an hour" - and the first reading is the alarming one, so it
// would cry wolf at anyone who leaves the site open.
//
// This returns just the collection timestamp, so a poll costs a few bytes
// instead of re-downloading the whole board.

const SOURCE = "https://raw.githubusercontent.com/Bordder/RLProTracker/main/data/derived/tracker.json";

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

export async function onRequestGet() {
  try {
    const res = await fetch(SOURCE + bust(), {
      cf: { cacheTtl: 30, cacheEverything: true },
      headers: { "User-Agent": "rlprotracker-site" },
    });
    if (!res.ok) return Response.json({ error: "upstream" }, { status: 502 });
    const { computedAt } = await res.json();
    return Response.json({ computedAt: computedAt ?? null }, {
      headers: { "cache-control": "public, max-age=20, s-maxage=30" },
    });
  } catch {
    return Response.json({ error: "upstream" }, { status: 502 });
  }
}

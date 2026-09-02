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

export async function onRequestGet() {
  try {
    const res = await fetch(SOURCE, {
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

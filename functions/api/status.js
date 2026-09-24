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
// Read the freshness-only file, not the whole board.
//
// This endpoint returns about 40 bytes. It used to get them out of tracker.json,
// which is 180 KB: every upstream read pulled and parsed the entire board to
// keep one timestamp. The edge cache below collapses that to one read every 20
// seconds, but those reads spend the same GH_TOKEN budget the collectors
// dispatch through, so a probe meant to be cheap was competing with collection.
// computeTrackerDeltas now writes derived/status.json holding just computedAt,
// from the same value at the same instant.
//
// tracker.json stays as the fallback, and not only for the deploy in which
// status.json does not exist yet: the two are published in one commit by the
// same job, so anything that leaves status.json missing later means the tracker
// pipeline itself has changed, and answering from the board is better than
// answering 502.
const FILES = ["status.json", "tracker.json"];
const apiUrl = (f) => `https://api.github.com/repos/Bordder/RLProTracker/contents/data/derived/${f}?ref=data`;
const rawUrl = (f) => `https://raw.githubusercontent.com/Bordder/RLProTracker/data/data/derived/${f}`;

// `etag` is the validator of the status.json copy kept here, if there is one.
// The read of status.json is then conditional, and an unchanged file answers
// 304 without spending GH_TOKEN's rate limit - the same revalidation the /data
// Function does, for the same reason. Returns which file answered and from
// where, so only the API's own status.json is ever kept as that base.
export async function fetchTracker(env, etag = null) {
  const headers = {
    Accept: "application/vnd.github.raw",
    "User-Agent": "rlprotracker-site",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (env && env.GH_TOKEN) headers.Authorization = `Bearer ${env.GH_TOKEN.trim()}`;
  let last = null;
  for (const f of FILES) {
    const conditional = f === FILES[0] && etag;
    const res = await fetch(apiUrl(f), { headers: conditional ? { ...headers, "If-None-Match": etag } : headers, cf: { cacheTtl: 20 } });
    if (res.ok || (conditional && res.status === 304)) return { res, file: f, api: true };
    last = await fetch(rawUrl(f), { cf: { cacheTtl: 30 }, headers: { "User-Agent": "rlprotracker-site" } });
    if (last.ok) return { res: last, file: f, api: false };
  }
  return last ? { res: last, file: null, api: false } : null;
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
  // The last status.json read from the API, with its ETag. The same key the
  // /data Function keeps its copy of the file under, and the same shape.
  const baseKey = request
    ? new Request(new URL("/__data/status.json", request.url).toString(), { method: "GET" })
    : null;
  const kept = baseKey ? await cache.match(baseKey) : null;
  const keptTag = kept ? kept.headers.get("etag") : null;
  const canWait = typeof (context && context.waitUntil) === "function";
  const keep = (text, etag) => {
    if (!baseKey || !etag || !canWait) return;
    context.waitUntil(cache.put(baseKey, new Response(text, {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=86400", etag },
    })));
  };

  try {
    const got = await fetchTracker(context && context.env, keptTag);
    const res = got && got.res;
    let text;
    if (res && res.status === 304 && kept) {
      text = await kept.text();
      keep(text, keptTag);
    } else if (res && res.ok) {
      text = await res.text();
      if (got.api && got.file === FILES[0]) keep(text, res.headers.get("etag"));
    } else {
      return withCors(Response.json({ error: "upstream" }, { status: 502 }));
    }
    const { computedAt } = JSON.parse(text);
    const body = { computedAt: computedAt ?? null };
    const headers = { "cache-control": `public, max-age=20, s-maxage=${HOT_TTL}` };
    if (hotKey && canWait) {
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


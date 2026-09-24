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
// Collector output lives on the `data` branch: main carries code only, so
// its history is readable. Both URLs below have to point at the same branch.
const RAW_BASE = "https://raw.githubusercontent.com/Bordder/RLProTracker/data/data/derived";

// `etag`, when given, is the one the copy already held here was served with.
// GitHub answers an unchanged file with a 304 and no body, and a 304 to an
// authorised conditional request is not counted against the rate limit: most
// of these reads are of a file that has not moved since the last one. The
// 304 is returned as it is, never sent on to the raw fallback, because the
// caller has the bytes it stands for.
export async function fetchDerived(file, env, etag = null) {
  const headers = {
    Accept: "application/vnd.github.raw",
    "User-Agent": "rlprotracker-site",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (env && env.GH_TOKEN) headers.Authorization = `Bearer ${env.GH_TOKEN.trim()}`;
  if (etag) headers["If-None-Match"] = etag;
  const res = await fetch(`${API_BASE}/${file}?ref=data`, { headers, cf: { cacheTtl: 20 } });
  if (res.ok || (etag && res.status === 304)) return { res, from: "github-api" };
  // The API can rate limit an unauthenticated caller; raw is stale but better
  // than nothing, so it stays as the fallback rather than the default.
  const raw = await fetch(`${RAW_BASE}/${file}`, {
    cf: { cacheTtl: 30 },
    headers: { "User-Agent": "rlprotracker-site" },
  });
  return { res: raw, from: "raw-fallback" };
}

// How long one upstream read is shared by every visitor hitting this colo.
//
// This is a rate-limit guard, not a speed tweak. An authenticated API response
// carries Cache-Control: private and a subrequest with an Authorization header
// is never cached by Cloudflare, so without this every single visitor request
// would be its own API call. GH_TOKEN's 5000/hour is shared with the
// workflow_dispatch calls that drive the collectors, so enough traffic here
// would stop collection entirely and drop the site back to stale raw reads.
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


// The board's six feeds, as one file.
//
// Not a new collector output: this is assembled at the edge from the same six
// files, which are still served individually and still share one hot cache
// entry each, so a direct reader and a board reader warm the same copy.
//
// It exists because of REQUESTS, not bytes. Cloudflare's rate limit counts a
// burst per address, and on 16 September a visitor who opened the board and
// clicked through to the bracket sent about 40 requests inside two seconds and
// was answered with error 1015. Six of those were this page asking for six
// files it always wants together, in one volley, every single load. One asking
// is one request, and the bytes over the wire are unchanged.
const BOARD = [
  "steam-hours.json",
  "team-hours.json",
  "tracker.json",
  "team-tracker.json",
  "presence-hours.json",
  "event-now.json",
];
const BOARD_FILE = "board.json";

// Every file the site reads through this Function, and nothing else.
//
// Each request that gets past this goes upstream as an authenticated GitHub
// API call on the same token the cron Worker dispatches the collectors with,
// and a miss is never cached. A pattern here rather than a list let any
// made-up name through, so anybody could spend that budget and stop
// collection. Built from what the pages fetch: the board's feeds, the board
// document itself, the rating history, the bracket and the status page's
// uptime files. A new feed has to be added here before a page can read it.
const PUBLISHED = new Set([
  ...BOARD,
  BOARD_FILE,
  "mmr-history.json",
  "bracket.json",
  "uptime.json",
  "uptime-steam.json",
  "uptime-presence.json",
]);

/**
 * One derived file's bytes, through the hot cache, the upstream, and then the
 * long-lived backup copy, in that order.
 *
 * The backup copy is also what the upstream read is made against. It carries
 * the ETag GitHub served it with, so the read is conditional: a file that has
 * not changed comes back as a 304, which GitHub does not count against
 * GH_TOKEN's 5000 an hour, and the bytes already held here are served. Over
 * three hours of the data branch, tracker.json changed 91 times and
 * steam-hours.json 4, so at one read per file every 20 seconds per colo
 * nearly every read was of bytes this cache already had.
 *
 * @returns { body, from } or null when every one of those failed.
 */
export async function loadFile(file, context, request) {
  const cache = caches.default;
  const cacheKey = new Request(new URL(`/__data/${file}`, request.url).toString(), { method: "GET" });
  const hotKey = new Request(new URL(`/__hot/${file}`, request.url).toString(), { method: "GET" });

  const hot = await cache.match(hotKey);
  if (hot) return { body: await hot.arrayBuffer(), from: "hot" };

  const kept = await cache.match(cacheKey);
  const keptTag = kept ? kept.headers.get("etag") : null;

  let upstream = null;
  try {
    upstream = await fetchDerived(file, context.env, keptTag);
  } catch {
    upstream = null; // network failure - fall through to the cached copy
  }

  const store = (body, etag, ttl) => new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${ttl}`,
      ...(etag ? { etag } : null),
    },
  });

  if (upstream && upstream.res.status === 304 && kept) {
    // Unchanged upstream: the copy held here IS the current file. Both entries
    // are rewritten so the hot one is armed again and the backup keeps its day.
    const body = await kept.arrayBuffer();
    context.waitUntil(cache.put(cacheKey, store(body, keptTag, 86400)));
    context.waitUntil(cache.put(hotKey, store(body, keptTag, HOT_TTL)));
    return { body, from: "github-api-304" };
  }

  if (upstream && upstream.res.ok) {
    const body = await upstream.res.arrayBuffer();
    // Only the API's ETag is kept. raw.githubusercontent's is a different
    // validator for a different URL, and sending it to the API would only
    // ever miss.
    const etag = upstream.from === "github-api" ? upstream.res.headers.get("etag") : null;
    // Keep a long-lived copy as the fallback and as the base for the next
    // conditional read. Its age does not affect normal serving: a changed
    // file comes back as a 200 and replaces it.
    context.waitUntil(cache.put(cacheKey, store(body, etag, 86400)));
    context.waitUntil(cache.put(hotKey, store(body, etag, HOT_TTL)));
    return { body, from: upstream.from };
  }

  if (kept) return { body: await kept.arrayBuffer(), from: "stale", stale: true };
  return null;
}

// A feed's bytes as a JSON value, or null if they are not one.
//
// The merge splices upstream text into a document without parsing it, so
// whatever comes back is trusted to be JSON. Usually it is. But GitHub answers
// a rate limit, an outage or a moved file with an HTML page and a 200 in some
// paths, and splicing "<!DOCTYPE html>" between two braces produces a body the
// page cannot parse AT ALL: one bad feed takes out the other five, and the
// board goes blank rather than partial. The shape check below costs a scan of
// the first character and turns that into the missing-feed case the page
// already handles.
const asJson = (body) => {
  const text = new TextDecoder().decode(body).trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return null;
  return text;
};

/**
 * The six feeds as one document, keyed by the file each came from.
 *
 * Assembled as text rather than parsed and re-serialised: the six come to
 * about 150KB, and there is nothing to be gained from turning that into
 * objects at the edge and straight back into the same bytes.
 */
function assembleBoard(parts) {
  const body = BOARD.map((f, i) => {
    const text = parts[i] ? asJson(parts[i].body) : null;
    return `${JSON.stringify(f)}:${text ?? "null"}`;
  });
  return `{${body.join(",")}}`;
}

const jsonResponse = (body, extra = {}) => new Response(body, {
  headers: {
    "content-type": "application/json; charset=utf-8",
    // Browsers revalidate quickly; the edge absorbs the repeat traffic.
    "cache-control": `public, max-age=30, s-maxage=${HOT_TTL}`,
    ...extra,
  },
});

export async function onRequestGet(context) {
  const { request, params, waitUntil } = context;
  const file = (params.path || []).join("/");
  // Only ever proxy the published JSON: no path traversal, no fetching
  // arbitrary repo contents through the site's origin, and no upstream call
  // at all for a name the site does not publish.
  if (!PUBLISHED.has(file)) return withCors(new Response("not found", { status: 404 }));

  if (file === BOARD_FILE) {
    const cache = caches.default;
    const hotKey = new Request(new URL(`/__hot/${BOARD_FILE}`, request.url).toString(), { method: "GET" });
    const hot = await cache.match(hotKey);
    if (hot) return withCors(hot);

    const parts = await Promise.all(BOARD.map((f) => loadFile(f, context, request)));
    // Every feed unreachable is the 502 case. One missing feed is not: the
    // board renders what it has and says so, which is far better than an empty
    // page because team-hours.json hiccuped.
    if (parts.every((p) => !p)) return withCors(new Response("upstream error", { status: 502 }));

    const text = assembleBoard(parts);
    const headers = { "x-proxied-from": "board-merge" };
    if (parts.some((p) => p && p.stale)) headers["x-data-stale"] = "upstream-unavailable";
    waitUntil(cache.put(hotKey, jsonResponse(text, headers)));
    return withCors(jsonResponse(text, headers));
  }

  const part = await loadFile(file, context, request);
  if (!part) return withCors(new Response("upstream error", { status: 502 }));
  const headers = { "x-proxied-from": part.from };
  // Says plainly that this is a fallback, so a confusing number on the page
  // can be traced without guessing.
  if (part.stale) headers["x-data-stale"] = "upstream-unavailable";
  return withCors(jsonResponse(part.body, headers));
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


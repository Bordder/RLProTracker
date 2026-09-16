// Which tracked players are streaming right now.
//
// Needs two Pages secrets:
//   npx wrangler pages secret put TWITCH_CLIENT_ID     --project-name=rlprotracker
//   npx wrangler pages secret put TWITCH_CLIENT_SECRET --project-name=rlprotracker
//
// Server-side because the credentials cannot ship to a browser, same reason the
// feedback relay lives here. Two things about the shape of it matter more than
// the Twitch call itself:
//
// THE CHANNEL LIST IS NEVER TAKEN FROM THE REQUEST. It is read from this site's
// own player feed, and every query parameter is ignored. A `?channel=` would
// turn this into an open Twitch proxy running on our client id, which is the
// kind of endpoint that gets an app's access suspended rather than throttled.
//
// THE ANSWER IS EDGE CACHED. An unauthenticated public endpoint that makes an
// authenticated upstream call once per visitor is an amplifier - it is exactly
// what was just closed on the cron Worker, where an open health check spent the
// collectors' GitHub budget. One upstream call per minute serves everyone,
// however much traffic arrives.

// Get Streams takes up to 100 logins per request and costs 1 point either way,
// so the whole roster is one call. Chunked anyway: the roster grew from 60 to
// 104 in a fortnight and nothing would have told us when it crossed the line.
const MAX_LOGINS = 100;

// How long an answer is served before Twitch is asked again. A badge that is a
// minute stale is fine; the alternative is a call per visitor.
const LIVE_TTL = 60;

// App access tokens last about two months. Cached well short of that, and any
// 401 refreshes it anyway, so the clock is a backstop rather than the mechanism.
const TOKEN_TTL = 3600;

// Only this game counts as live here.
//
// The board is about Rocket League, and a pro streaming something else is not
// doing the thing the badge would be claiming. Filtered HERE rather than on the
// page so the answer never carries what a player is playing when it is not
// Rocket League: that is a fact about somebody's evening, the site has no use
// for it, and the smallest way to look after it is not to publish it.
const GAME = "Rocket League";

const json = (body, status = 200, ttl = 0) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": ttl ? `public, max-age=${ttl}` : "no-store",
    },
  });

// Twitch logins are lowercase; the roster stores them as the player writes them
// ("TorsosRL"), so everything is compared folded.
const fold = (s) => String(s || "").trim().toLowerCase();

/** Twitch's own rule for a login. Anything else never reaches a URL. */
const CHANNEL = /^[A-Za-z0-9_]{3,25}$/;

/** The channels to ask about, from our own feed. Exported for tests. */
export function channelsFrom(doc) {
  const out = new Set();
  for (const p of doc?.players ?? []) {
    const t = p?.twitch;
    if (t && CHANNEL.test(t)) out.add(fold(t));
  }
  return [...out];
}

export function chunk(list, n = MAX_LOGINS) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/**
 * Twitch's payload reduced to what a badge needs. Exported for tests.
 *
 * The stream TITLE is deliberately dropped. It is arbitrary text the streamer
 * controls, it would be the only free-form string on the board, and a badge
 * does not need it. Nothing here is worth the escaping it would require.
 */
export function liveFrom(streams, game = null) {
  const live = {};
  for (const s of streams ?? []) {
    const login = fold(s?.user_login);
    if (!login) continue;
    // "live" as opposed to a rerun, which Twitch also returns here.
    if (s.type && s.type !== "live") continue;
    if (game && fold(s?.game_name) !== fold(game)) continue;
    live[login] = {
      game: typeof s.game_name === "string" ? s.game_name : null,
      viewers: Number.isFinite(s.viewer_count) ? s.viewer_count : null,
      startedAt: typeof s.started_at === "string" ? s.started_at : null,
    };
  }
  return live;
}

// The token, kept in the edge cache so it is fetched about hourly rather than
// per request. caches.default keys have to be same-origin GETs, hence the
// synthetic path, which nothing routes to.
const tokenKey = (request) => new Request(new URL("/__tw/token", request.url).toString(), { method: "GET" });

async function appToken(env, request, ctx, { fresh = false } = {}) {
  const key = tokenKey(request);
  if (!fresh) {
    const hit = await caches.default.match(key);
    if (hit) {
      const t = await hit.text();
      if (t) return t;
    }
  }
  const body = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET,
    grant_type: "client_credentials",
  });
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return null;
  const doc = await res.json();
  const token = doc?.access_token;
  if (!token) return null;
  // Well inside what Twitch reports, so a cached token is never the one that
  // just expired.
  const ttl = Math.max(60, Math.min(TOKEN_TTL, Math.floor((doc.expires_in ?? TOKEN_TTL) / 2)));
  const store = new Response(token, { headers: { "cache-control": `public, max-age=${ttl}` } });
  if (ctx?.waitUntil) ctx.waitUntil(caches.default.put(key, store));
  else await caches.default.put(key, store);
  return token;
}

async function getStreams(logins, token, env) {
  const params = new URLSearchParams();
  for (const l of logins) params.append("user_login", l);
  params.set("first", String(MAX_LOGINS));
  const res = await fetch(`https://api.twitch.tv/helix/streams?${params}`, {
    headers: { "client-id": env.TWITCH_CLIENT_ID, authorization: `Bearer ${token}` },
  });
  return res;
}

export async function onRequestGet(context) {
  const { request, env, waitUntil } = context;

  // Missing credentials are not an error the page should see. The board simply
  // shows no badges, which is what it did before this existed.
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
    return json({ computedAt: new Date().toISOString(), live: {}, configured: false }, 200, LIVE_TTL);
  }

  const cache = caches.default;
  // The cache key ignores the query string on purpose: no input to this endpoint
  // is honoured, so every caller must share one entry.
  const key = new Request(new URL("/__tw/live", request.url).toString(), { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit;

  let live = {};
  let ok = false;
  try {
    const feed = await fetch(new URL("/data/tracker.json", request.url).toString(), {
      headers: { accept: "application/json" },
    });
    const doc = feed.ok ? await feed.json() : null;
    const logins = channelsFrom(doc);

    if (logins.length) {
      let token = await appToken(env, request, context);
      if (token) {
        const all = [];
        ok = true;
        for (const group of chunk(logins)) {
          let res = await getStreams(group, token, env);
          // One retry with a forced-fresh token: a cached token can be revoked
          // or expire early, and the cheapest way to find out is being told.
          if (res.status === 401) {
            token = await appToken(env, request, context, { fresh: true });
            if (!token) { ok = false; break; }
            res = await getStreams(group, token, env);
          }
          if (!res.ok) { ok = false; break; }
          const body = await res.json();
          all.push(...(body?.data ?? []));
        }
        if (ok) live = liveFrom(all, GAME);
      }
    } else {
      // No channels to ask about is a valid, empty answer.
      ok = true;
    }
  } catch {
    ok = false;
  }

  const payload = { computedAt: new Date().toISOString(), live, configured: true };
  // A failed lookup is cached briefly too. Without that, an outage at Twitch
  // turns every page load into another upstream attempt.
  const ttl = ok ? LIVE_TTL : 30;
  const res = json(payload, 200, ttl);
  if (waitUntil) waitUntil(cache.put(key, res.clone()));
  else await cache.put(key, res.clone());
  return res;
}

export async function onRequestHead(context) {
  const res = await onRequestGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}

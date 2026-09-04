// /p/<player id> - one player's shareable card.
//
// Data is read back through this site's own /data proxy rather than reaching
// for GitHub again: that Function already holds the edge cache, the token and
// the stale-copy fallback, so a card costs one cached subrequest instead of a
// second code path that can rate-limit the collectors.

import { renderCard } from "../../lib/playerCard.mjs";

const HTML = { "content-type": "text/html; charset=utf-8" };

// Ids come from the roster and are slugs already (e.g. team-vitality-zen).
// Anything else is rejected before it reaches a lookup or the page.
const ID = /^[a-z0-9-]{1,80}$/;

async function derived(request, file) {
  const res = await fetch(new URL(`/data/${file}`, request.url).toString(), {
    headers: { accept: "application/json" },
  });
  if (!res.ok) return null;
  return res.json();
}

function notFound(slug) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Player not found &middot; RL Pro Tracker</title>` +
      `<meta name="robots" content="noindex">` +
      `<body style="background:#0C0E13;color:#F2EFE6;font:15px/1.5 system-ui;padding:48px 20px;max-width:600px;margin:0 auto">` +
      `<h1 style="font-size:20px">No tracked player at that address</h1>` +
      `<p style="color:#8B90A0">${slug ? "That id is not on the roster" : "No player id given"}. ` +
      `<a href="/" style="color:#FF5A1F">Back to the board</a>.</p>`,
    { status: 404, headers: { ...HTML, "cache-control": "no-store" } }
  );
}

export async function onRequestGet({ request, params }) {
  const slug = String(params.slug || "").toLowerCase();
  if (!ID.test(slug)) return notFound(null);

  const tracker = await derived(request, "tracker.json");
  if (!tracker) return new Response("upstream error", { status: 502, headers: { "cache-control": "no-store" } });

  const player = (tracker.players || []).find((p) => p.id === slug);
  if (!player) return notFound(slug);

  // Hours are a nice-to-have: a third of the roster hides them, and the card is
  // built around games for exactly that reason. A failure here must not take the
  // page down with it.
  let hours = null;
  try {
    const sh = await derived(request, "steam-hours.json");
    hours = (sh?.players || []).find((h) => h.id === slug) || null;
  } catch { /* card renders without the hours block */ }

  const origin = new URL(request.url).origin;
  const html = renderCard({ player, hours, origin, computedAt: tracker.computedAt });

  return new Response(html, {
    headers: {
      ...HTML,
      // The numbers move every few minutes, and a card is usually opened once
      // from a link rather than reloaded, so the edge holds it briefly and
      // browsers revalidate fast. Crawlers get whatever is current.
      "cache-control": "public, max-age=30, s-maxage=60",
    },
  });
}

import test from "node:test";
import assert from "node:assert/strict";
import { renderCard, claimLine, tierClass, isLive, teamSlug } from "../lib/playerCard.mjs";
import { onRequestGet } from "../functions/p/[slug].js";

const NOW = Date.parse("2026-09-04T12:00:00.000Z");

const player = (over = {}) => ({
  id: "nrg-atomic",
  name: "Atomic",
  team: "NRG",
  updatedAt: "2026-09-04T11:55:00.000Z",
  lastPlayedAt: "2026-09-04T06:00:00.000Z",
  session: null,
  mmr: { ones: 1216, twos: 2419, threes: 1571 },
  tier: { ones: "Grand Champion I", twos: "Supersonic Legend", threes: "Grand Champion I" },
  seasonGames: { ones: 0, twos: 603, threes: 0, total: 603 },
  games: {
    ones: { d1: { games: 0, partial: false }, d7: { games: 0, partial: true }, d14: { games: 0, partial: true } },
    twos: { d1: { games: 47, partial: false }, d7: { games: 85, partial: true }, d14: { games: 85, partial: true } },
    threes: { d1: { games: 0, partial: false }, d7: { games: 0, partial: true }, d14: { games: 0, partial: true } },
    total: { d1: { games: 47, partial: false }, d7: { games: 85, partial: true }, d14: { games: 85, partial: true } },
  },
  ...over,
});

const render = (over, hours) =>
  renderCard({ player: player(over), hours, origin: "https://198x.online", computedAt: "2026-09-04T11:55:00.000Z", now: NOW });

test("the claim leads with games in the last 24 hours", () => {
  assert.equal(claimLine(player(), NOW), "47 ranked games in the last 24 hours");
});

test("a live session outranks the 24 hour count in the claim", () => {
  const p = player({
    lastPlayedAt: new Date(NOW - 5 * 60e3).toISOString(),
    session: { startedAt: new Date(NOW - 95 * 60e3).toISOString(), games: 11 },
  });
  assert.equal(claimLine(p, NOW), "Playing ranked right now: 11 games in 1h 35m");
  assert.equal(isLive(p, NOW), true);
});

test("a quiet day falls back to the 7 day count, then to when they last played", () => {
  const quiet = { total: { d1: { games: 0, partial: false }, d7: { games: 63, partial: true }, d14: { games: 63, partial: true } } };
  assert.equal(claimLine(player({ games: quiet }), NOW), "63 ranked games in the last 7 days");

  const cold = { total: { d1: { games: 0, partial: false }, d7: { games: 0, partial: false }, d14: { games: 0, partial: false } } };
  assert.match(claimLine(player({ games: cold }), NOW), /^No ranked games in 24 hours\. Last played /);
});

test("tier colour follows the reported rank, not the MMR number", () => {
  // 1,216 is Grand Champion I in 1v1 and nowhere near it in 2v2, so the number
  // alone cannot decide the colour.
  assert.equal(tierClass("Grand Champion I"), "t-gc");
  assert.equal(tierClass("Supersonic Legend"), "t-ssl");
  assert.equal(tierClass("Champion III"), "t-champ");
  assert.equal(tierClass(null), "t-low");
});

test("the share tags carry the claim, not a generic site description", () => {
  const html = render();
  assert.match(html, /<meta property="og:title" content="Atomic - 47 ranked games in the last 24 hours">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/198x\.online\/p\/nrg-atomic">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/198x\.online\/p\/nrg-atomic">/);
});

test("no em dashes reach the page", () => {
  assert.equal(render().includes("—"), false);
  assert.equal(render().includes("&mdash;"), false);
});

test("the hours block is dropped when the player hides their Steam details", () => {
  const blank = { windows: { d1: { hours: null }, d7: { hours: null }, d14: { hours: null } } };
  const html = render({}, blank);
  assert.equal(html.includes("Hours in game"), false);
  assert.match(html, /Atomic hides their Steam game details/);

  const some = { windows: { d1: { hours: 7.2 }, d7: { hours: null }, d14: { hours: null } } };
  assert.match(render({}, some), /Hours in game/);
});

test("a partial window is marked rather than presented as a total", () => {
  const html = render();
  assert.match(html, /85<span class="pt"[^>]*>\+<\/span>/);
});

test("player names are escaped into the markup and the meta tags", () => {
  const html = render({ name: '<img src=x onerror=alert(1)>"', id: "nrg-x" });
  assert.equal(html.includes("<img src=x"), false);
  assert.match(html, /&lt;img src=x/);
});

test("only public team marks are used, everyone else gets a monogram", () => {
  assert.match(render({ team: "NRG" }), /img\/teams\/nrg\.png/);
  const noLogo = render({ team: "Ninjas in Pyjamas" });
  assert.equal(noLogo.includes("img/teams/"), false);
  assert.match(noLogo, /<span class="av">NI<\/span>/);
  assert.equal(teamSlug("Ninjas in Pyjamas"), "ninjas-in-pyjamas");
});

// ---- the route ---------------------------------------------------------

const TRACKER = { computedAt: "2026-09-04T11:55:00.000Z", players: [player()] };
const HOURS = { players: [{ id: "nrg-atomic", windows: { d1: { hours: 3.5 }, d7: { hours: null }, d14: { hours: null } } }] };

function stubFetch(map) {
  return async (url) => {
    const path = new URL(url).pathname;
    if (!(path in map)) return new Response("not found", { status: 404 });
    const body = map[path];
    return body === null
      ? new Response("upstream error", { status: 502 })
      : new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  };
}

const call = async (slug, map) => {
  const saved = globalThis.fetch;
  globalThis.fetch = stubFetch(map);
  try {
    return await onRequestGet({
      request: new Request(`https://198x.online/p/${slug}`),
      params: { slug },
    });
  } finally {
    globalThis.fetch = saved;
  }
};

const FULL = { "/data/tracker.json": TRACKER, "/data/steam-hours.json": HOURS };

test("route: a known player renders their card", async () => {
  const res = await call("nrg-atomic", FULL);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  const html = await res.text();
  assert.match(html, /<h1>Atomic<\/h1>/);
  assert.match(html, /Hours in game/);
});

test("route: an unknown player is a 404, not an empty card", async () => {
  const res = await call("not-a-player", FULL);
  assert.equal(res.status, 404);
  assert.match(await res.text(), /not on the roster/);
});

test("route: a malformed id never reaches a lookup", async () => {
  for (const bad of ["../../etc/passwd", "a b", "x".repeat(200), "<script>"]) {
    const res = await call(bad, FULL);
    assert.equal(res.status, 404, bad);
  }
});

test("route: the card still renders when the hours feed is unavailable", async () => {
  const res = await call("nrg-atomic", { "/data/tracker.json": TRACKER, "/data/steam-hours.json": null });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<h1>Atomic<\/h1>/);
  assert.equal(html.includes("Hours in game"), false);
});

test("route: a tracker feed failure is a 502, not a card of blanks", async () => {
  const res = await call("nrg-atomic", { "/data/tracker.json": null });
  assert.equal(res.status, 502);
});

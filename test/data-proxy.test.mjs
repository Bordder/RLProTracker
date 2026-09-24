// The /data Function only proxies files the site actually publishes.
//
// Every request it forwards is an authenticated GitHub API call on the same
// token the cron Worker dispatches the collectors with, and a miss was never
// cached, so any made-up name was a free way to spend that budget. A name the
// site does not publish has to be refused before anything goes upstream.
import { test } from "node:test";
import assert from "node:assert/strict";

const calls = [];
globalThis.fetch = async (url) => { calls.push(String(url)); return new Response("{}", { status: 200 }); };
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

const { onRequestGet } = await import("../functions/data/[[path]].js");

const ctx = (file) => ({
  request: new Request(`https://198x.online/data/${file}`),
  params: { path: [file] },
  env: { GH_TOKEN: "t" },
  waitUntil: () => {},
});

test("a name the site does not publish is a 404 with no upstream call", async () => {
  calls.length = 0;
  const res = await onRequestGet(ctx("made-up-123.json"));
  assert.equal(res.status, 404);
  assert.equal(calls.length, 0);
});

test("every file the pages read is still served", async () => {
  for (const f of ["board.json", "tracker.json", "team-tracker.json", "steam-hours.json", "team-hours.json",
    "presence-hours.json", "event-now.json", "mmr-history.json", "bracket.json",
    "uptime.json", "uptime-steam.json", "uptime-presence.json"]) {
    calls.length = 0;
    const res = await onRequestGet(ctx(f));
    assert.equal(res.status, 200, f);
    assert.ok(calls.length > 0, f);
  }
});

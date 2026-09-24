// web/status.js, run as the browser runs it, against a fake page and a fake
// /data endpoint.
//
// What it guards is the request count. The page refreshes every 30 seconds for
// as long as it is open, and every request it makes is one more against
// Cloudflare's per-visitor rate limit and, on a cold edge, one more read of
// GH_TOKEN's budget. It used to ask for eight files, one of them twice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const src = await readFile("web/status.js", "utf8");
const NOW = Date.now();
const iso = (minsAgo) => new Date(NOW - minsAgo * 60000).toISOString();
const mins = (minsAgo) => Math.floor((NOW - minsAgo * 60000) / 60000);

const FEEDS = {
  "tracker.json": { computedAt: iso(1), players: [{ mmr: { twos: 1800 } }, { mmr: { twos: 1700 } }, { mmr: {} }] },
  "steam-hours.json": { computedAt: iso(20), players: [{ totalHours: 5 }, { totalHours: null }] },
  "presence-hours.json": { computedAt: iso(2), players: [] },
  "team-tracker.json": { computedAt: iso(1), teams: [{ team: "A" }, { team: "B" }] },
};
const UPTIME = {
  "uptime.json": { runs: [mins(1), mins(3)] },
  "uptime-steam.json": { runs: [mins(20)] },
  "uptime-presence.json": { runs: [mins(2)] },
};

async function runPage(board) {
  const asked = [];
  const els = {};
  const el = () => ({ innerHTML: "", textContent: "", className: "" });
  const document = {
    hidden: false,
    getElementById: (id) => (els[id] ??= el()),
    addEventListener: () => {},
  };
  const fetch = async (url) => {
    const path = String(url).split("?")[0];
    asked.push(path);
    const name = path.replace("/data/", "");
    const body = name === "board.json" ? board : (UPTIME[name] ?? FEEDS[name]);
    return { ok: body != null, json: async () => body };
  };
  const window = { addEventListener: () => {} };
  vm.runInNewContext(src, { window, document, fetch, setInterval: () => 0, Date, Math, String, Promise, Array, isNaN });
  // Let the refresh's promise chain settle.
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  return { asked, els };
}

test("one refresh is four requests: the board document and each history file once", async () => {
  const { asked } = await runPage({ ...FEEDS, "team-hours.json": { teams: [] }, "event-now.json": null });
  assert.deepEqual([...asked].sort(), ["/data/board.json", "/data/uptime-presence.json", "/data/uptime-steam.json", "/data/uptime.json"]);
});

test("the page reads its four feeds out of the board document", async () => {
  const { els } = await runPage({ ...FEEDS, "team-hours.json": { teams: [] }, "event-now.json": null });
  // Coverage is counted from the feeds themselves: 2 of 3 ranked, 2 teams, 1 of 2 with hours.
  assert.match(els.cov.innerHTML, /Players ranked<\/span><span class="v">2 <small>\/ 3<\/small>/);
  assert.match(els.cov.innerHTML, /Teams covered<\/span><span class="v">2</);
  assert.match(els.cov.innerHTML, /Playtime visible<\/span><span class="v">1 <small>\/ 2<\/small>/);
  assert.equal(els.verdictTitle.textContent, "Everything is running");
});

test("a feed missing from the board document reads as a feed that did not load", async () => {
  const { els } = await runPage({ ...FEEDS, "steam-hours.json": null });
  assert.match(els.cols.innerHTML, /is-bad[\s\S]*Steam playtime[\s\S]*no reading/);
  assert.equal(els.verdictTitle.textContent, "Something is not updating");
});

test("an unreachable board document is the site-down case, as eight failed fetches were", async () => {
  const { els } = await runPage(null);
  assert.equal(els.verdictTitle.textContent, "Cannot reach the data");
});

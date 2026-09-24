// The /data Function's upstream reads, against a fake GitHub.
//
// GH_TOKEN's 5000 requests an hour are shared with the Worker that dispatches
// every collector, so what these tests count is how many reads GitHub would
// bill. A 304 to an authorised conditional request is not billed; a 200 is.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadFile, fetchDerived } from "../functions/data/[[path]].js";

// caches.default, as far as the Function uses it: exact-URL match and put.
function memoryCache() {
  const store = new Map();
  return {
    store,
    async match(req) {
      const hit = store.get(typeof req === "string" ? req : req.url);
      return hit ? hit.clone() : undefined;
    },
    async put(req, res) { store.set(typeof req === "string" ? req : req.url, res.clone()); },
  };
}

// A fake api.github.com and raw.githubusercontent.com. Files can be changed
// between reads; `billed` counts the API answers GitHub would charge for.
function fakeGitHub(files) {
  const gh = { files, billed: 0, conditional: 0, notModified: 0, raw: 0, apiDown: false };
  gh.fetch = async (url, init = {}) => {
    const u = String(url);
    const name = u.split("/").pop().split("?")[0];
    if (u.startsWith("https://raw.githubusercontent.com/")) {
      gh.raw++;
      return new Response(gh.files[name], { status: 200, headers: { etag: '"raw-validator"' } });
    }
    if (gh.apiDown) return new Response("oops", { status: 503 });
    const body = gh.files[name];
    const etag = `"${Buffer.from(body).toString("base64").slice(0, 16)}"`;
    const inm = init.headers?.["If-None-Match"];
    if (inm) gh.conditional++;
    if (inm && inm === etag) { gh.notModified++; return new Response(null, { status: 304, headers: { etag } }); }
    gh.billed++;
    return new Response(body, { status: 200, headers: { etag } });
  };
  return gh;
}

let realFetch, realCaches, gh, cache;
const ctx = () => {
  const pending = [];
  return { env: { GH_TOKEN: "t" }, waitUntil: (p) => pending.push(p), settle: () => Promise.all(pending) };
};
const REQ = new Request("https://198x.online/data/tracker.json");
const text = (ab) => new TextDecoder().decode(ab);
// The hot entry lives 20 seconds. Dropping it is what 20 seconds passing
// looks like to the Function.
const expireHot = () => { for (const k of [...cache.store.keys()]) if (k.includes("/__hot/")) cache.store.delete(k); };

beforeEach(() => {
  realFetch = globalThis.fetch; realCaches = globalThis.caches;
  gh = fakeGitHub({ "tracker.json": "{\"v\":1}" });
  cache = memoryCache();
  globalThis.fetch = gh.fetch;
  globalThis.caches = { default: cache };
});
afterEach(() => { globalThis.fetch = realFetch; globalThis.caches = realCaches; });

test("an unchanged file is revalidated for free and served from the copy held here", async () => {
  let c = ctx();
  const first = await loadFile("tracker.json", c, REQ); await c.settle();
  assert.equal(text(first.body), "{\"v\":1}");
  assert.equal(gh.billed, 1);

  for (let i = 0; i < 5; i++) {
    expireHot();
    c = ctx();
    const again = await loadFile("tracker.json", c, REQ); await c.settle();
    assert.equal(text(again.body), "{\"v\":1}");
    assert.equal(again.from, "github-api-304");
  }
  assert.equal(gh.billed, 1, "an unchanged file was billed again");
  assert.equal(gh.notModified, 5);
  assert.equal(gh.raw, 0, "a 304 was sent on to the raw fallback");
});

test("a changed file is read in full and replaces the copy", async () => {
  let c = ctx();
  await loadFile("tracker.json", c, REQ); await c.settle();
  gh.files["tracker.json"] = "{\"v\":2}";
  expireHot();
  c = ctx();
  const next = await loadFile("tracker.json", c, REQ); await c.settle();
  assert.equal(text(next.body), "{\"v\":2}");
  assert.equal(next.from, "github-api");
  assert.equal(gh.billed, 2);
  // And the new copy is the base for the read after it.
  expireHot();
  c = ctx();
  const third = await loadFile("tracker.json", c, REQ); await c.settle();
  assert.equal(text(third.body), "{\"v\":2}");
  assert.equal(gh.billed, 2);
});

test("the hot entry still answers without asking GitHub at all", async () => {
  const c = ctx();
  await loadFile("tracker.json", c, REQ); await c.settle();
  const hit = await loadFile("tracker.json", ctx(), REQ);
  assert.equal(hit.from, "hot");
  assert.equal(gh.billed + gh.conditional, 1);
});

test("an API outage still serves raw, and raw's validator is never sent to the API", async () => {
  gh.apiDown = true;
  let c = ctx();
  const r = await loadFile("tracker.json", c, REQ); await c.settle();
  assert.equal(r.from, "raw-fallback");
  assert.equal(text(r.body), "{\"v\":1}");
  gh.apiDown = false;
  expireHot();
  c = ctx();
  await loadFile("tracker.json", c, REQ); await c.settle();
  assert.equal(gh.conditional, 0, "raw's ETag went to the API");
});

test("with everything upstream failing, the held copy is served as stale", async () => {
  let c = ctx();
  await loadFile("tracker.json", c, REQ); await c.settle();
  expireHot();
  globalThis.fetch = async () => { throw new Error("network"); };
  c = ctx();
  const r = await loadFile("tracker.json", c, REQ);
  assert.equal(r.stale, true);
  assert.equal(text(r.body), "{\"v\":1}");
});

test("fetchDerived is only conditional when there is a validator to send", async () => {
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push(init.headers["If-None-Match"] ?? null); return new Response("{}", { status: 200 }); };
  await fetchDerived("tracker.json", { GH_TOKEN: "t" });
  await fetchDerived("tracker.json", { GH_TOKEN: "t" }, "\"abc\"");
  assert.deepEqual(seen, [null, "\"abc\""]);
});

test("a board read that finds all six unchanged bills nothing", async () => {
  const { onRequestGet } = await import("../functions/data/[[path]].js");
  const six = ["steam-hours.json", "team-hours.json", "tracker.json", "team-tracker.json", "presence-hours.json", "event-now.json"];
  for (const f of six) gh.files[f] = JSON.stringify({ f });
  const board = async () => {
    const c = ctx();
    const res = await onRequestGet({ request: new Request("https://198x.online/data/board.json"), params: { path: ["board.json"] }, env: c.env, waitUntil: c.waitUntil });
    await c.settle();
    return JSON.parse(await res.text());
  };
  const first = await board();
  assert.deepEqual(first["tracker.json"], { f: "tracker.json" });
  assert.equal(gh.billed, 6);
  expireHot();
  const second = await board();
  assert.deepEqual(second, first);
  assert.equal(gh.billed, 6, "unchanged feeds were billed again");
  assert.equal(gh.notModified, 6);
});

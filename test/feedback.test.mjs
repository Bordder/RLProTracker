// The feedback relay. Anything can post to it, not only the form.
import { test } from "node:test";
import assert from "node:assert/strict";

const calls = [];
globalThis.fetch = async (url) => { calls.push(String(url)); return new Response("{}", { status: 201 }); };
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
const { onRequest } = await import("../functions/feedback.js");

const post = (body, headers = {}) => onRequest({
  request: new Request("https://198x.online/feedback", {
    method: "POST", body, headers: { "content-type": "application/json", origin: "https://198x.online", ...headers },
  }),
  env: { GH_TOKEN: "t" },
  waitUntil: () => {},
});

test("a body that is valid JSON but not an object is a 400, not a crash", async () => {
  for (const body of ["null", "42", '"text"', "[]"]) {
    calls.length = 0;
    const res = await post(body);
    assert.equal(res.status, 400, body);
    assert.equal(calls.length, 0, body);
  }
});

const good = JSON.stringify({ message: "The 2v2 column shows the wrong number for Zen today", type: "Bug" });

test("another site cannot post feedback through a visitor's browser", async () => {
  // A text/plain POST needs no preflight, so any page could make its visitors
  // file issues here. A browser always says where a POST came from.
  calls.length = 0;
  const res = await post(good, { origin: "https://evil.example", "content-type": "text/plain" });
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});

test("the form on the site still posts", async () => {
  calls.length = 0;
  const res = await post(good);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
});

test("a message cannot mention GitHub users", async () => {
  let sent = null;
  globalThis.fetch = async (url, init) => { sent = JSON.parse(init.body); return new Response("{}", { status: 201 }); };
  const res = await post(JSON.stringify({ message: "hey @someone and @other, please look at this bug", user: "@mallory" }), { "cf-connecting-ip": "10.0.0.9" });
  assert.equal(res.status, 200);
  assert.ok(!/(^|[^​])@[a-z]/i.test(sent.title + sent.body), sent.title + sent.body);
});

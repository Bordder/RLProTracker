// The feedback relay's handling of the request body.
//
// Everything it accepts ends up as a public GitHub issue filed with the site's
// token, so the body is checked before anything is parsed or sent: a size cap
// first, then fields that can only take the shape the form gives them.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/feedback.js";

// The Workers runtime globals the handler touches, stubbed: no cooldown entry,
// and a GitHub that files whatever it is given.
let filed;
beforeEach(() => {
  filed = [];
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  globalThis.fetch = async (_url, init) => {
    filed.push(JSON.parse(init.body));
    return new Response("{}", { status: 201 });
  };
});

const post = (body, headers = {}) => onRequest({
  request: new Request("https://198x.online/feedback", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...headers },
  }),
  env: { GH_TOKEN: "token" },
  waitUntil: () => {},
});

const message = "The ratings chart on a phone cuts off the last week of data.";

test("an ordinary submission is filed", async () => {
  const res = await post(JSON.stringify({ user: "someone", type: "Bug", message }));
  assert.equal(res.status, 200);
  assert.equal(filed.length, 1);
  assert.match(filed[0].title, /^Bug from someone: /);
});

test("a body far larger than the form can send is refused unread", async () => {
  const res = await post(JSON.stringify({ message, hp: "", pad: "x".repeat(64 * 1024) }));
  assert.equal(res.status, 413);
  assert.equal(filed.length, 0);
});

test("a declared length over the cap is refused before the body is read", async () => {
  const res = await post(JSON.stringify({ message }), { "content-length": String(1024 * 1024) });
  assert.equal(res.status, 413);
  assert.equal(filed.length, 0);
});

test("the name stays on one line in the issue", async () => {
  const res = await post(JSON.stringify({ user: "first\nsecond\r\n\tthird", message }));
  assert.equal(res.status, 200);
  assert.equal(filed.length, 1);
  assert.ok(!/[\r\n\t]/.test(filed[0].title));
  assert.match(filed[0].title, /from first second third: /);
  assert.match(filed[0].body, /\nFrom: first second third\n/);
});

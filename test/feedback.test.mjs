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

// The presence log's sealed copy in the Actions cache.
//
// Caches written on main can be restored by a pull request from a fork, and a
// fork never sees the repository's secrets. So the property that matters is
// that the cached bytes are useless without PRESENCE_LOG_KEY, and that a wrong
// or missing key is told apart from a real log rather than misread as one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { seal, unseal } from "../scripts/presenceLogCache.mjs";

const log = Buffer.from('{"t":"2026-09-24T00:00:00.000Z","inGame":["team-a-player"]}\n');

test("a sealed log opens with the same key", () => {
  assert.deepEqual(unseal(seal(log, "key-one"), "key-one"), log);
});

test("the sealed bytes do not carry the log in the clear", () => {
  const sealed = seal(log, "key-one");
  assert.ok(!sealed.includes(Buffer.from("team-a-player")));
  assert.ok(!sealed.includes(Buffer.from("inGame")));
});

test("the wrong key cannot open it", () => {
  assert.equal(unseal(seal(log, "key-one"), "key-two"), null);
});

test("a tampered or truncated copy cannot be opened", () => {
  const sealed = seal(log, "key-one");
  const flipped = Buffer.from(sealed);
  flipped[flipped.length - 1] ^= 1;
  assert.equal(unseal(flipped, "key-one"), null);
  assert.equal(unseal(sealed.subarray(0, 10), "key-one"), null);
  assert.equal(unseal(Buffer.alloc(0), "key-one"), null);
});

test("an unsealed file is not mistaken for a sealed one", () => {
  assert.equal(unseal(log, "key-one"), null);
});

test("two seals of the same log differ", () => {
  // A fresh nonce every time: reusing one under GCM would leak the XOR of
  // two logs, and the cache holds many versions of nearly the same file.
  assert.notDeepEqual(seal(log, "key-one"), seal(log, "key-one"));
});

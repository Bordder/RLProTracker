// The scrape-rate alert posts once, again if it worsens, then every 12 hours.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldPost, REMIND_MS } from "../scripts/alertCooldown.mjs";

const t0 = Date.parse("2026-09-24T12:00:00Z");
const at = new Date(t0).toISOString();

test("the first alert, or the first after a recovery, posts", () => {
  assert.equal(shouldPost(null, 1, t0), true);
  assert.equal(shouldPost({ at: null, level: 0 }, 2, t0), true);
});

test("the same condition an hour later does not post again", () => {
  assert.equal(shouldPost({ at, level: 2 }, 2, t0 + 3600e3), false);
  assert.equal(shouldPost({ at, level: 2 }, 1, t0 + 3600e3), false, "easing off is not news");
});

test("getting worse posts at once; a long stretch gets a reminder", () => {
  assert.equal(shouldPost({ at, level: 1 }, 2, t0 + 60e3), true);
  assert.equal(shouldPost({ at, level: 2 }, 2, t0 + REMIND_MS), true);
});

// The phone's event view: header, schedule, teams and prize pool.
//
// This module used to import its neighbours by absolute path ("/crest.mjs"),
// which a browser resolves against the site root and node cannot resolve at
// all, so nothing in it could be tested. fixtures.mjs already imports
// "./crest.mjs" for exactly this reason, and resolves to the same URL on the
// site.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dateRange } from "../web/eventview.mjs";

const plain = (s) => s.replace(/\s/g, " ");

test("the module loads under node", () => {
  assert.equal(typeof dateRange, "function");
});

test("an event's dates read as one range, in the order the locale uses", () => {
  const ev = { starts: "2026-09-15", ends: "2026-09-20" };
  assert.equal(plain(dateRange(ev, "en-GB")), "15 – 20 September 2026");
  assert.equal(plain(dateRange(ev, "en-US")), "September 15 – 20, 2026");
  assert.equal(plain(dateRange({ starts: "2026-09-30", ends: "2026-10-02" }, "en-GB")), "30 September – 2 October 2026");
  assert.equal(dateRange({ starts: "2026-09-18", ends: "2026-09-18" }, "en-GB"), "18 September 2026");
});

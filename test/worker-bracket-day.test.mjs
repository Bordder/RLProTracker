// The cron Worker decides how often to dispatch the bracket collector by
// asking whether a LAN is being played. It keeps its own copy of the rule the
// page uses (eventRunning), because it cannot import the page module, so the
// two are checked against each other here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lanRunning } from "../worker/src/lanRunning.js";
import { eventRunning } from "../web/fixtures.mjs";

const T = (iso) => Date.parse(iso);
const ev = (matches = []) => ({ starts: "2024-09-10", ends: "2024-09-15", stages: [{ brackets: [{ matches }], matchlists: [] }] });

test("a North American final past midnight UTC keeps the fast cadence", () => {
  assert.equal(lanRunning({ events: [ev()] }, T("2024-09-16T00:30:00Z")), true);
});

test("the Worker and the page agree about when a LAN is on", () => {
  const cases = [
    [ev(), "2024-09-08T23:59:00Z"], [ev(), "2024-09-09T00:00:00Z"], [ev(), "2024-09-17T00:00:00Z"],
    [ev(), "2024-09-17T00:01:00Z"], [ev(), "2025-01-01T00:00:00Z"],
    [ev([{ finished: false, startsAt: "2024-09-18T01:00:00Z" }]), "2024-09-18T02:00:00Z"],
    [ev([{ finished: false, startsAt: "2024-09-18T01:00:00Z" }]), "2024-09-18T04:00:00Z"],
    [ev([{ finished: true, startsAt: "2024-09-18T01:00:00Z" }]), "2024-09-18T02:00:00Z"],
  ];
  for (const [e, at] of cases) assert.equal(lanRunning({ events: [e] }, T(at)), eventRunning(e, T(at)), at);
});

// ---- the scheduled handler -----------------------------------------------------

import worker from "../worker/src/index.js";

test("a Worker with no GH_TOKEN bound says so instead of throwing", async () => {
  // env.GH_TOKEN.trim() threw a TypeError on every dispatch, so the log showed
  // rejections rather than the missing binding the health check names.
  const logs = [];
  const log = console.log;
  console.log = (m) => logs.push(String(m));
  globalThis.fetch = async () => new Response("{}", { status: 404 });
  let job;
  try {
    await worker.scheduled({ cron: "7 * * * *", scheduledTime: Date.now() }, { GH_OWNER: "o", GH_REPO: "r", GH_REF: "main" },
      { waitUntil: (p) => { job = p; } });
    await assert.doesNotReject(job);
  } finally { console.log = log; }
  assert.ok(logs.some((l) => /GH_TOKEN/.test(l)), logs.join("\n"));
});

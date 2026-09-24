// The Chromium cache has to follow the Playwright the lockfile installs.
//
// Its key used to be a hand-written version, and it went stale without a
// sound: the key said 1.62.1 while npm ci installed 1.63.0, so every tracker
// run restored a browser build nothing launched, deleted it, and downloaded
// the right one again. A key that matches is never re-saved, so it could not
// heal on its own. Nothing failed; every run was just 15 seconds slower.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const WORKFLOWS = [".github/workflows/tracker.yml", ".github/workflows/proxy-health.yml"];

test("the Chromium cache key is read from the installed Playwright, never written by hand", async () => {
  for (const f of WORKFLOWS) {
    const src = await readFile(f, "utf8");
    const keys = [...src.matchAll(/key:\s*(playwright-[^\n]+)/g)].map((m) => m[1]);
    assert.ok(keys.length, `${f}: no Playwright cache key found`);
    for (const k of keys) {
      assert.doesNotMatch(k, /\d+\.\d+\.\d+/, `${f}: literal version in cache key ${k}`);
      assert.match(k, /steps\.pw\.outputs\.version/, `${f}: cache key ${k} does not follow the installed version`);
    }
    assert.match(src, /require\('playwright\/package\.json'\)\.version/, `${f}: version is not read from node_modules`);
  }
});

test("only the headless shell is installed, and the cache key says so", async () => {
  // launch({ headless: true }) runs chromium-headless-shell. The full browser
  // is 187 MiB that nothing launches.
  for (const f of WORKFLOWS) {
    const src = await readFile(f, "utf8");
    const installs = [...src.matchAll(/npx playwright install(?!-deps)([^\n]*)/g)].map((m) => m[1]);
    assert.ok(installs.length, `${f}: no playwright install step`);
    for (const args of installs) assert.match(args, /--only-shell/, `${f}: installs more than the headless shell`);
    assert.match(src, /key:\s*playwright-[^\n]*-shell\s*$/m, `${f}: cache key does not mark the shell-only set`);
  }
});

test("every script that launches Chromium runs it headless", async () => {
  // --only-shell is only safe while nothing asks for the full browser. A
  // headed launch or a channel would need it back.
  for (const f of ["scripts/fetchTracker.mjs", "scripts/proxyProbe.mjs", "scripts/checkProxies.mjs"]) {
    const src = await readFile(f, "utf8");
    const launches = [...src.matchAll(/chromium\.launch\(([^)]*)\)/g)].map((m) => m[1]);
    assert.ok(launches.length, `${f}: no chromium.launch found`);
    for (const opts of launches) {
      assert.match(opts, /headless:\s*true/, `${f}: launch is not headless`);
      assert.doesNotMatch(opts, /channel/, `${f}: launch names a channel`);
    }
  }
});

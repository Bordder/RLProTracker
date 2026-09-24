// Scripts meant to be run by hand must actually run when they are.
//
// Five of them were gated on import.meta.main, which exists only from Node
// 24.2. package.json promises Node 20 or later, and on 20 or 22 each of them
// exited 0 having done nothing at all: no output, no purge, no resolve. The
// collector even logged a successful team resolve that had written nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = (script, args = [], env = {}) =>
  spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...process.env, ...env } });

test("purgeSeason runs when invoked, and says there is nothing to purge", () => {
  const r = run("scripts/purgeSeason.mjs", [], { DATA_DIR: mkdtempSync(join(tmpdir(), "purge-")) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /nothing to purge/);
});

test("resolveTeams runs when invoked, and asks for its arguments", () => {
  const r = run("scripts/resolveTeams.mjs");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage/);
});

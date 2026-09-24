// The board (web/rlpt.js, a plain script) and the bracket pages (web/crest.mjs,
// a module) each keep an alias map from a team's spelling to its logo file,
// because neither can import the other. The board also uses its map to match
// the teams at a LAN to roster rows, so a spelling one map knows and the other
// does not draws a monogram on one page and loses the LAN tag on the other.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const aliases = (src, marker) => {
  const at = src.indexOf(marker);
  const body = src.slice(src.indexOf("{", at) + 1, src.indexOf("};", at));
  return Object.fromEntries([...body.matchAll(/["']([a-z0-9-]+)["']\s*:\s*["']([a-z0-9-]+)["']/g)].map((m) => [m[1], m[2]]));
};

test("every alias the bracket pages know, the board knows too", async () => {
  const page = aliases(await readFile("web/crest.mjs", "utf8"), "const LOGO_ALIAS");
  const board = aliases(await readFile("web/rlpt.js", "utf8"), "var LOGO_ALIAS");
  for (const [from, to] of Object.entries(page)) {
    if (from === to) continue;
    assert.equal(board[from], to, `web/rlpt.js LOGO_ALIAS is missing ${from} -> ${to}`);
  }
});

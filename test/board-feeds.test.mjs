// The board's feed list is written down three times, and all three must agree.
//
// The page asks for one merged document, a Pages Function assembles it at the
// edge, and the local preview server fakes the same endpoint so a checkout
// works with no Cloudflare. Each holds its own copy of the list, in order,
// because none of them can import from the others: the Function runs on
// Workers globals, the page is a plain script with no modules, and the server
// is Node.
//
// The failure this guards against is silent. The page maps the merged document
// back to an array BY POSITION, so one list drifting by a single entry does
// not error - it hands the team feed to the code expecting Steam hours, and
// the board renders confidently wrong numbers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/** The .json file names inside `<name> = [ ... ]`, in source order. */
const listIn = (src, name) => {
  // The three declarations are spelled differently: `const BOARD = [`, and on
  // the page a minified-style `var BOARD_FEEDS=[`. Find the name, then the
  // first bracket after it, rather than pinning the whitespace.
  const at = src.indexOf(name);
  assert.notEqual(at, -1, `no ${name} array found`);
  const open = src.indexOf("[", at);
  const close = src.indexOf("]", open);
  return src
    .slice(open + 1, close)
    .split(",")
    .map((s) => s.trim().replace(/^["']|["'],?$/g, ""))
    .filter((s) => s.endsWith(".json"));
};

test("the page, the edge and the preview server list the same six feeds", async () => {
  const edge = listIn(await readFile("functions/data/[[path]].js", "utf8"), "BOARD");
  const page = listIn(await readFile("web/rlpt.js", "utf8"), "BOARD_FEEDS");
  const local = listIn(await readFile("scripts/serve.mjs", "utf8"), "BOARD_FEEDS");

  assert.equal(edge.length, 6);
  assert.deepEqual(page, edge);
  assert.deepEqual(local, edge);
});

test("the merged document is keyed by file name, so a rename cannot go unnoticed", async () => {
  // The page reads b['tracker.json'] rather than b[2]. A feed renamed in one
  // place and not the other then yields null, which the page already handles
  // as "this feed did not come back", instead of silently shifting the rest.
  const page = await readFile("web/rlpt.js", "utf8");
  assert.ok(page.includes("BOARD_FEEDS.map(function(f){return b[f]||null;})"));
});

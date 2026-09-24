// The Content-Security-Policy buildSite.mjs writes into web/_headers, checked
// against what the pages actually load. The policy starts from default-src
// 'none', so anything a page links that has no directive of its own is
// refused, silently, in every visitor's browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const directives = async () => {
  const src = await readFile("scripts/buildSite.mjs", "utf8");
  const block = src.slice(src.indexOf("const csp = ["), src.indexOf('].join("; ")'));
  return [...block.matchAll(/"([a-z-]+) ([^"]+)"/g)].map((m) => m[1]);
};

test("a page that links a web app manifest is allowed to load it", async () => {
  const pages = (await readdir("web")).filter((f) => f.endsWith(".html"));
  const linking = [];
  for (const p of pages) if ((await readFile(`web/${p}`, "utf8")).includes('rel="manifest"')) linking.push(p);
  assert.ok(linking.length, "some page links the manifest");
  assert.ok((await directives()).includes("manifest-src"), `manifest-src is missing; ${linking.join(", ")} link one`);
});

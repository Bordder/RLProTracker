// Fetch the bracket shapes every cached event needs, once each.
//
//   node fetchShapes.mjs           only shapes not already cached
//   node fetchShapes.mjs --all     refetch everything
//
// Shapes come from Liquipedia's COMMONS wiki, which is a different host from
// the rocketleague one the collector reads:
//
//   https://liquipedia.net/commons/Template:Bracket/<name>
//
// They are immutable - a format change gets a new template name - so this is
// a one-off per shape, not part of the polling loop. Requests are spaced 2
// seconds apart like everything else here.

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadEvents } from "./events.mjs";
import { UA, sleep, readCached } from "./assemble.mjs";
import { parseBrackets } from "./parseBracket.mjs";
import { parseShape } from "./shape.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
export const SHAPE_DIR = join(ROOT, "data", "bracket", "shapes");

const ALL = process.argv.includes("--all");

/** "Bracket/8-2Q-U-4L2D-2Q" -> "bracket-8-2q-u-4l2d-2q.json" */
export const shapeFile = (template) =>
  String(template).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".json";

async function fetchShape(template) {
  const title = `Template:${template}`;
  const url = "https://liquipedia.net/commons/api.php?action=query&prop=revisions" +
    `&rvprop=content&rvslots=main&format=json&titles=${encodeURIComponent(title)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const page = Object.values((await res.json()).query.pages)[0];
  if (!page?.revisions) throw new Error(`no such template on commons: ${title}`);
  return page.revisions[0].slots.main["*"];
}

// Which templates the cached pages actually use.
const wanted = new Set();
for (const event of await loadEvents()) {
  for (const t of event.titles) {
    const text = await readCached(t.cache).catch(() => null);
    if (!text) continue;
    for (const b of parseBrackets(text)) if (b.template) wanted.add(b.template);
  }
}
console.log(`${wanted.size} bracket shape(s) in use`);

await mkdir(SHAPE_DIR, { recursive: true });
let n = 0;
for (const template of wanted) {
  const out = join(SHAPE_DIR, shapeFile(template));
  const have = await access(out).then(() => true, () => false);
  if (have && !ALL) { console.log(`${template}: cached`); continue; }
  if (n++) await sleep(2000);
  try {
    const text = await fetchShape(template);
    const shape = parseShape(text);
    const withEdges = Object.values(shape.edges).filter((e) => e.upper || e.lower).length;
    await writeFile(out, JSON.stringify({ template, fetchedAt: new Date().toISOString(), ...shape }, null, 2) + "\n");
    console.log(`${template}: ${shape.order.length} slots, ${withEdges} with feeders -> shapes/${shapeFile(template)}`);
  } catch (err) {
    // A missing shape is not fatal: the page falls back to drawing no
    // connectors for that bracket, which is what it did before this existed.
    console.log(`${template}: FAILED - ${err.message}`);
  }
}

// One file the page can fetch, rather than one request per bracket.
const index = {};
for (const template of wanted) {
  try {
    index[template] = JSON.parse(await readFile(join(SHAPE_DIR, shapeFile(template)), "utf8"));
  } catch { /* skipped above, and already reported */ }
}
await writeFile(join(ROOT, "data", "bracket", "shapes.json"), JSON.stringify(index, null, 2) + "\n");
console.log(`shapes.json -> ${Object.keys(index).length} shape(s)`);

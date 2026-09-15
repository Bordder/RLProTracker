// Freeze the current cache as a test fixture.
//
//   node snapshot.mjs worlds-2026 worlds-midseries
//
// The one page state no fixture covers is a bracket half filled in: both
// existing fixtures are all-empty (Worlds before it started) or all-finished
// (a closed regional). That state only exists while an event is actually
// being played, so it has to be captured on the day or not at all.
//
// Run this during Worlds, ideally mid-session with some series live, then add
// the assertions to test.mjs.

import { copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadEvents } from "./events.mjs";
import { CACHE_DIR, FIXTURE_DIR } from "./assemble.mjs";
import { parsePage } from "./parseBracket.mjs";

const [slug, name] = process.argv.slice(2);
if (!slug || !name) {
  console.error("usage: node snapshot.mjs <event-slug> <fixture-name>");
  process.exit(1);
}

const event = (await loadEvents()).find((e) => e.slug === slug);
if (!event) throw new Error(`no event with slug ${slug}`);

for (const [n, t] of event.titles.entries()) {
  const from = join(CACHE_DIR, t.cache);
  const suffix = event.titles.length > 1 ? `-${n + 1}` : "";
  const to = join(FIXTURE_DIR, `${name}${suffix}.wikitext`);
  await copyFile(from, to);

  // Report what was actually captured, because a snapshot taken at the wrong
  // moment is worthless and there is no second chance at it.
  const page = parsePage(await readFile(to, "utf8"));
  console.log(`${to}`);
  const c = page.counts;
  console.log(`  ${c.matches} matches, ${c.played} played, ${c.live} live, ${c.upcoming} upcoming`);
  if (c.played === 0) console.log("  WARNING: nothing played yet - this is the same state as the existing fixture");
  if (c.upcoming === 0) console.log("  WARNING: everything is finished - this is the same state as the regional fixture");
  // The whole reason to run this during an event: a series with a score and no
  // finished flag is the state neither other fixture can ever hold.
  if (c.live === 0) console.log("  WARNING: no series in progress - capture again mid-session if that is what you wanted");
}

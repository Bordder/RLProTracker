// Turn wikitext into bracket.json, once, from the cache by default.
//
// LOCAL ONLY. Everything in this folder is gitignored.
//
//   node build.mjs              from fixtures/, offline, instant
//   node build.mjs --live       one request per title, 2s apart
//
// For a running collector that follows the matches, use collect.mjs. This is
// the one-shot version: it is what you want while working on the parser or
// the page, and it is offline by default deliberately. The parser needs
// running hundreds of times while it is being written, and doing that against
// Liquipedia would breach the 1-request-per-2-seconds courtesy limit within a
// minute. Ad-hoc requests already got this IP throttled site-wide on
// 10 September.

import { join } from "node:path";
import { loadEvents } from "./events.mjs";
import {
  CACHE_DIR, OUT_PATH, sleep, parseEvent, buildDoc, writeAtomic, writeBracketDoc, fetchWikitext,
} from "./assemble.mjs";

const LIVE = process.argv.includes("--live");
const events = await loadEvents();

if (LIVE) {
  let first = true;
  for (const event of events) {
    for (const t of event.titles) {
      if (!first) await sleep(2000);
      first = false;
      const text = await fetchWikitext(t.title);
      await writeAtomic(join(CACHE_DIR, t.cache), text);
      console.log(`fetched ${t.title} (${Math.round(text.length / 1024)} KB) and refreshed the cache`);
    }
  }
}

const parsed = [];
for (const event of events) parsed.push(await parseEvent(event));

const doc = buildDoc(parsed, LIVE ? "liquipedia" : "cache");
await writeBracketDoc(doc);

for (const e of parsed) {
  console.log(`${e.name}: ${e.counts.matches} matches, ${e.counts.played} played, ${e.counts.upcoming} upcoming`);
  for (const s of e.stages) {
    console.log(`  ${s.brackets.length} bracket(s), ${s.matchlists.length} group list(s)`);
  }
}
console.log(`wrote bracket.json from ${doc.source}`);

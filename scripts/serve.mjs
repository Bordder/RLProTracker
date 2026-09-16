// Local preview server. Serves web/ as the site root (same layout Cloudflare
// Pages publishes), after copying data/derived into web/ so relative fetches work.
// No dependencies.
//
//   node scripts/serve.mjs                    the data this checkout has
//   node scripts/serve.mjs --seed             the committed sample data
//   node scripts/serve.mjs --seed season-reset  the board as it will look on
//                                             the first day of a season
//
// The seed sets come from scripts/seedFixtures.mjs. --seed makes a fresh
// checkout render a full board with no collector output and without pulling the
// data branch, which overwrites the hand-maintained roster; season-reset is the
// only way to look at the 23 September boundary before it happens.

import { createServer } from "node:http";
import { readFile, readdir, mkdir, copyFile, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "web");
const PORT = process.env.PORT || 5173;

// Which set of JSON to serve. The default is whatever this checkout collected;
// --seed takes the committed sample instead, optionally a named variant.
const seedArg = process.argv.indexOf("--seed");
const SEED = seedArg === -1 ? null : (process.argv[seedArg + 1] ?? "").startsWith("-") || !process.argv[seedArg + 1]
  ? "" : process.argv[seedArg + 1];
const DATA_SRC = SEED === null
  ? join(ROOT, "data", "derived")
  : join(ROOT, "data", "fixtures", SEED);
// .mjs matters: the bracket page imports ES modules, and a module served as
// application/octet-stream is refused outright under strict MIME checking.
// The images are here for the team crests.
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json",
  ".xml": "application/xml", ".txt": "text/plain",
};

// Kept in step with BOARD in functions/data/[[path]].js and BOARD_FEEDS in
// web/rlpt.js: all three describe the same six files in the same order.
const BOARD_FEEDS = [
  "steam-hours.json",
  "team-hours.json",
  "tracker.json",
  "team-tracker.json",
  "presence-hours.json",
  "event-now.json",
];

// Copy latest derived data into web/ before serving.
//
// The page fetches its JSON files in parallel, so several requests land at once
// and would each start a copy. Copying onto a file that another request is busy
// reading serves a half-written body, which shows up as a JSON parse error and
// an empty table. Two things prevent that: writes go to a temp file and are
// renamed into place (a reader sees either the old file or the new one, never a
// partial one), and concurrent callers share a single in-flight run.
let syncing = null;

async function copyDerived() {
  const src = DATA_SRC;
  const dest = join(WEB, "data", "derived");
  await mkdir(dest, { recursive: true });
  try {
    // A seed set is smaller than the real one, and a file it does not carry
    // would otherwise be left behind from an earlier run: the teams tab showed
    // 35 teams from a stale team-hours.json over a 7-team seed. Serving a seed
    // means serving ONLY the seed.
    if (SEED !== null) {
      const keep = new Set(await readdir(src));
      for (const f of await readdir(dest)) {
        if (f.endsWith(".json") && !keep.has(f)) await rm(join(dest, f), { force: true });
      }
    }
    for (const f of await readdir(src)) {
      if (!f.endsWith(".json")) continue;
      const tmp = join(dest, `.${f}.tmp`);
      await copyFile(join(src, f), tmp);
      await rename(tmp, join(dest, f));   // atomic swap
    }
  } catch {}
}

function syncData() {
  if (!syncing) syncing = copyDerived().finally(() => { syncing = null; });
  return syncing;
}

await syncData();

createServer(async (req, res) => {
  let path = decodeURIComponent(req.url.split("?")[0]);
  // Re-sync on each derived-data request: the hourly jobs rewrite data/derived
  // while the server stays up, and a startup-only copy would serve stale JSON.
  if (path.startsWith("/data/derived/")) await syncData();
  // Production serves the JSON from /data/<file>.json via a Pages Function.
  // Mirror that here so a local build with DATA_BASE=/data behaves the same;
  // otherwise the page silently 404s every data file locally.
  // Production merges the board's six feeds into one document at the edge, so
  // the page makes one request rather than six. There is no Function here, and
  // without this the board fetches its only data file, gets the static 404 and
  // renders empty - which looks exactly like a data outage.
  if (path === "/data/board.json") {
    await syncData();
    const merged = {};
    for (const f of BOARD_FEEDS) {
      try {
        merged[f] = JSON.parse(await readFile(join(WEB, "data", "derived", f), "utf8"));
      } catch {
        merged[f] = null;
      }
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(merged));
    return;
  }
  if (/^\/data\/[a-z0-9-]+\.json$/i.test(path)) {
    await syncData();
    path = path.replace("/data/", "/data/derived/");
  }
  // Production serves this from a Pages Function at /api/status so an open tab
  // can check for newer data cheaply. Mirror it at the same path: at "/status"
  // it both missed the poll the page actually makes and swallowed the status
  // PAGE, which is a real file sitting at that URL.
  if (path === "/api/status") {
    await syncData();
    let computedAt = null;
    try {
      ({ computedAt } = JSON.parse(await readFile(join(WEB, "data", "derived", "tracker.json"), "utf8")));
    } catch {}
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify({ computedAt: computedAt ?? null }));
  }
  if (path === "/") path = "/index.html";
  const file = normalize(join(WEB, path));
  if (!file.startsWith(WEB)) { res.writeHead(403); return res.end("forbidden"); }
  try {
    // Cloudflare Pages serves /how-it-works from how-it-works.html, so the
    // local preview has to as well or every footer link 404s here only.
    const body = extname(file)
      ? await readFile(file)
      : await readFile(file + ".html").catch(() => readFile(file));
    res.writeHead(200, { "content-type": TYPES[extname(file) || ".html"] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}).listen(PORT, () => console.log(
  `serving web/ on http://localhost:${PORT}` +
  (SEED === null ? "" : `  (seed: ${SEED || "current"})`)
));

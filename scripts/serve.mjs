// Local preview server. Serves web/ as the site root (same layout Cloudflare
// Pages publishes), after copying data/derived into web/ so relative fetches work.
// No dependencies.  Usage:  node scripts/serve.mjs   (default port 5173)

import { createServer } from "node:http";
import { readFile, readdir, mkdir, copyFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "web");
const PORT = process.env.PORT || 5173;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml" };

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
  const src = join(ROOT, "data", "derived");
  const dest = join(WEB, "data", "derived");
  await mkdir(dest, { recursive: true });
  try {
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
  if (path === "/") path = "/index.html";
  const file = normalize(join(WEB, path));
  if (!file.startsWith(WEB)) { res.writeHead(403); return res.end("forbidden"); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}).listen(PORT, () => console.log(`serving web/ on http://localhost:${PORT}`));

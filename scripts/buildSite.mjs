// Prepare web/ as a self-contained publish root:
//  - copy data/derived/*.json into web/data/derived (so relative fetch works)
//  - optionally write web/config.js setting window.__DATA_BASE__ when
//    DATA_BASE env is provided (production: point at the repo's raw JSON URL so
//    data refreshes need no site rebuild).
//
// Usage:  npm run build:site   (DATA_BASE optional)

import { readdir, readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "data", "derived");
const DEST = join(ROOT, "web", "data", "derived");

await mkdir(DEST, { recursive: true });
try {
  for (const f of await readdir(SRC)) {
    if (f.endsWith(".json")) await copyFile(join(SRC, f), join(DEST, f));
  }
  console.log(`copied derived JSON -> web/data/derived`);
} catch {
  console.log("no data/derived yet - skipping copy");
}

const base = process.env.DATA_BASE;
const cfg = base
  ? `window.__DATA_BASE__=${JSON.stringify(base)};`
  : `/* no DATA_BASE set - site uses bundled ./data/derived */`;
await writeFile(join(ROOT, "web", "config.js"), cfg + "\n");
console.log(base ? `web/config.js -> DATA_BASE=${base}` : "web/config.js -> bundled data");

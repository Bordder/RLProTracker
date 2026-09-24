// Delete snapshots older than 15 days so the repo doesn't grow forever.
// 15 days keeps enough history for the 14-day window plus margin.
// Covers both the Steam and tracker snapshot directories.

import { readdir, readFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEEP_MS = 15 * 24 * 3600e3;
const DIRS = [
  { dir: join(ROOT, "data", "snapshots"), prefix: "steam-" },
  { dir: join(ROOT, "data", "tracker-snapshots"), prefix: "tracker-" },
];

async function pruneDir(dir, prefix) {
  let files;
  try { files = (await readdir(dir)).filter((f) => f.startsWith(prefix) && f.endsWith(".json")); }
  catch { return; }
  if (!files.length) return;

  // newest snapshot's time as "now" (avoids Date.now / clock-skew dependence)
  let now = 0;
  for (const f of files) now = Math.max(now, Date.parse(JSON.parse(await readFile(join(dir, f), "utf8")).takenAt));

  let removed = 0;
  for (const f of files) {
    const t = Date.parse(JSON.parse(await readFile(join(dir, f), "utf8")).takenAt);
    if (now - t > KEEP_MS) { await unlink(join(dir, f)); removed++; }
  }
  console.log(`prune ${prefix}: kept ${files.length - removed}, removed ${removed}`);
}

async function main() {
  for (const { dir, prefix } of DIRS) await pruneDir(dir, prefix);
}

main().catch((e) => { console.error(e); process.exit(1); });

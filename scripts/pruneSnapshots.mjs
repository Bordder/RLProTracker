// Delete Steam snapshots older than 15 days so the repo doesn't grow forever.
// 15 days keeps enough history for the 14-day window plus margin.
// Hourly => ~360 files at steady state.

import { readdir, readFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAP_DIR = join(ROOT, "data", "snapshots");
const KEEP_MS = 15 * 24 * 3600e3;

async function main() {
  let files;
  try { files = (await readdir(SNAP_DIR)).filter((f) => f.startsWith("steam-") && f.endsWith(".json")); }
  catch { return; }

  // find newest snapshot's time as "now" (avoids Date.now dependence / clock skew)
  let now = 0;
  for (const f of files) {
    const s = JSON.parse(await readFile(join(SNAP_DIR, f), "utf8"));
    now = Math.max(now, Date.parse(s.takenAt));
  }

  let removed = 0;
  for (const f of files) {
    const s = JSON.parse(await readFile(join(SNAP_DIR, f), "utf8"));
    if (now - Date.parse(s.takenAt) > KEEP_MS) { await unlink(join(SNAP_DIR, f)); removed++; }
  }
  console.log(`pruneSnapshots: kept ${files.length - removed}, removed ${removed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

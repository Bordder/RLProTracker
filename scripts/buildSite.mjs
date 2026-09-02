// Prepare web/ as a self-contained publish root:
//  - copy data/derived/*.json into web/data/derived (so relative fetch works)
//  - write web/_headers with a Content-Security-Policy whose script hashes are
//    computed from the page itself, so the policy cannot drift out of date
//  - optionally write web/config.js setting window.__DATA_BASE__ when
//    DATA_BASE env is provided (production: point at the repo's raw JSON URL so
//    data refreshes need no site rebuild).
//
// Usage:  npm run build:site   (DATA_BASE optional)

import { readdir, readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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

// ---- Content-Security-Policy -------------------------------------------
//
// Cloudflare Pages serves headers from a _headers file in the publish root.
// The page's JavaScript is inline, so rather than allowing 'unsafe-inline' for
// scripts - which would defeat most of the point - we hash each inline block
// and list the hashes. Generating this at build time means an edit to the page
// can never silently invalidate the policy.
//
// Styles still need 'unsafe-inline': the page sets style attributes from JS
// (team colours, logo insets), and inline style attributes cannot be hashed.
// That is a much smaller exposure than script injection.
const html = await readFile(join(ROOT, "web", "index.html"), "utf8");
const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => `'sha256-${createHash("sha256").update(m[1], "utf8").digest("base64")}'`);

// config.js is a separate file, so 'self' covers it. connect-src has to allow
// wherever the JSON actually lives (raw.githubusercontent.com in production)
// plus the Worker that receives feedback.
const csp = [
  "default-src 'none'",
  `script-src 'self' ${hashes.join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://raw.githubusercontent.com https://*.workers.dev",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

await writeFile(join(ROOT, "web", "_headers"), [
  "/*",
  `  Content-Security-Policy: ${csp}`,
  "  X-Content-Type-Options: nosniff",
  "  Referrer-Policy: no-referrer",
  "  Permissions-Policy: geolocation=(), microphone=(), camera=(), interest-cohort=()",
  "",
  "# Data JSON is rewritten every few minutes; never let a CDN or browser pin it.",
  "/data/derived/*",
  "  Cache-Control: no-cache",
  "",
  "# Fonts are content-addressed by name and never change under the same name.",
  "/fonts/*",
  "  Cache-Control: public, max-age=31536000, immutable",
  "",
].join("\n"));
console.log(`web/_headers -> CSP with ${hashes.length} script hash(es)`);

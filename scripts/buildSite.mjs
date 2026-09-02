// Prepare web/ as a self-contained publish root:
//  - copy data/derived/*.json into web/data/derived (so relative fetch works)
//  - write web/_headers with a Content-Security-Policy
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

// ---- Content-Security-Policy -------------------------------------------
//
// Cloudflare Pages serves headers from a _headers file in the publish root.
//
// The page's JavaScript lives in app.js rather than inline, which is what makes
// this policy simple: 'self' covers it and no hashing is involved. An earlier
// version hashed an inline script and it broke in production - the served HTML
// hashed correctly from curl, yet browsers computed a different value and
// blocked the script, leaving the page stuck on "LOADING". Hash-based CSP is
// too brittle when anything in the delivery path can touch the markup.
//
// Styles still need 'unsafe-inline': the page sets style attributes from JS
// (team colours, logo insets), and inline style attributes cannot be hashed.
// That is a much smaller exposure than script injection.
//
// Cloudflare Pages injects a Web Analytics beacon from static.cloudflareinsights.com.
// It is cookieless and does no cross-site tracking, and it is the only source of a
// unique-visitor count, so it is allowed explicitly.
const csp = [
  "default-src 'none'",
  "script-src 'self' https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://raw.githubusercontent.com https://*.workers.dev https://cloudflareinsights.com",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

await writeFile(join(ROOT, "web", "_headers"), [
  "/*",
  `  Content-Security-Policy: ${csp}`,
  "  X-Content-Type-Options: nosniff",
  "  Referrer-Policy: no-referrer",
  "  Permissions-Policy: geolocation=(), microphone=(), camera=()",
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
console.log("web/_headers -> CSP written");

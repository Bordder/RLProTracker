// Prepare web/ as a self-contained publish root:
//  - copy data/derived/*.json into web/data/derived (so relative fetch works)
//  - write web/_headers with a Content-Security-Policy
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

// config.js is deliberately gone. It existed to point the page at a data host,
// but data is served from this origin by the /data Pages Function now, so the
// page just defaults to "/data" and there is nothing to configure.
//
// It was also actively dangerous: Pages caches assets for four hours, and a
// Pages BUILD env var (DATA_BASE) still holding an old raw.githubusercontent URL
// silently overwrote a correct deploy - shipping a config the CSP then blocked,
// which left every visitor looking at an empty table for as long as their
// browser held the file. One less moving part.

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
  // Both data and feedback are same-origin Pages Functions now, so the only
  // outbound destination left is the analytics beacon.
  "connect-src 'self' https://cloudflareinsights.com",
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

// ---- cache-bust the page script -----------------------------------------
//
// Pages serves static assets with a four-hour Cache-Control and ignores any
// override in _headers, so a fix to rlpt.js does not reach anyone still holding
// the old copy. That is not theoretical: a stale data path survived two deploys
// that way, leaving the live page with an empty table.
//
// The HTML itself is always revalidated, so stamping the script reference with a
// hash of its contents means a changed script is fetched immediately and an
// unchanged one still hits cache.
const scriptPath = join(ROOT, "web", "rlpt.js");
const scriptHash = createHash("sha256").update(await readFile(scriptPath)).digest("hex").slice(0, 8);
const indexPath = join(ROOT, "web", "index.html");
const indexHtml = await readFile(indexPath, "utf8");
const stamped = indexHtml.replace(/src="rlpt\.js(?:\?v=[0-9a-f]+)?"/, `src="rlpt.js?v=${scriptHash}"`);
if (stamped !== indexHtml) {
  await writeFile(indexPath, stamped);
  console.log(`web/index.html -> rlpt.js?v=${scriptHash}`);
} else {
  console.log(`rlpt.js?v=${scriptHash} (unchanged)`);
}

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
  "# Font FILES are content-addressed by name and never change under the same name.",
  "/fonts/*.woff2",
  "  Cache-Control: public, max-age=31536000, immutable",
  "",
  "# The stylesheet is NOT content-addressed: it keeps one URL and its contents",
  "# change. It used to be swept up by the /fonts/* rule above and served",
  "# immutable for a year, which is how a fixed stylesheet stayed broken: after",
  "# the deploy that repaired it, the edge was still answering with a copy 2.3",
  "# days old (cf-cache-status HIT, Age 200452) and would have done so until",
  "# 2027. The pages request it with a ?v= stamp, so this only has to be short",
  "# enough that an unstamped request cannot pin a stale copy.",
  "/fonts/fonts.css",
  "  Cache-Control: public, max-age=300",
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
for (const [page, script] of [["index.html", "rlpt.js"], ["status.html", "status.js"]]) {
  // Hash the normalised text, not the raw bytes. On Windows git checks these
  // files out with CRLF while the editor writes LF, so hashing bytes made the
  // stamp flip back and forth on every checkout: a phantom diff in index.html
  // and a pointless cache bust for every visitor.
  const source = (await readFile(join(ROOT, "web", script), "utf8")).replace(/\r\n/g, "\n");
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 8);
  const pagePath = join(ROOT, "web", page);
  const html = await readFile(pagePath, "utf8");
  const pattern = new RegExp(`src="${script.replace(/\./g, "\\.")}(?:\\?v=[0-9a-f]+)?"`);
  const stamped = html.replace(pattern, `src="${script}?v=${hash}"`);
  if (stamped !== html) {
    await writeFile(pagePath, stamped);
    console.log(`web/${page} -> ${script}?v=${hash}`);
  } else {
    console.log(`${script}?v=${hash} (unchanged)`);
  }
}

// ---- cache-bust the font stylesheet --------------------------------------
//
// Same problem as the page script, and it had already bitten. fonts/fonts.css
// keeps one URL while its contents change, so the immutable header it used to
// inherit meant a corrected stylesheet never reached anyone: the deploy that
// fixed the subpage font paths went out and the edge kept answering with a copy
// 2.3 days old. index.html is immune because it inlines its own @font-face,
// which is exactly why the breakage was invisible on the page people look at.
//
// The woff2 files need no stamp: one file per family now, named for the family,
// and a different font would be a different name.
{
  const css = (await readFile(join(ROOT, "web", "fonts", "fonts.css"), "utf8")).replace(/\r\n/g, "\n");
  const hash = createHash("sha256").update(css).digest("hex").slice(0, 8);
  const pattern = /href="fonts\/fonts\.css(?:\?v=[0-9a-f]+)?"/;
  let stamped = 0;
  for (const page of await readdir(join(ROOT, "web"))) {
    if (!page.endsWith(".html")) continue;
    const pagePath = join(ROOT, "web", page);
    const html = await readFile(pagePath, "utf8");
    if (!pattern.test(html)) continue;               // index.html inlines its faces
    const out = html.replace(pattern, `href="fonts/fonts.css?v=${hash}"`);
    if (out !== html) { await writeFile(pagePath, out); stamped++; }
  }
  console.log(`fonts.css?v=${hash} -> ${stamped} page(s) restamped`);
}

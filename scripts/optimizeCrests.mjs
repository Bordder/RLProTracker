// Re-encode the team crests to the size they are actually drawn at.
//
//   node scripts/optimizeCrests.mjs [--apply]
//
// The marks were dropped in at whatever size each org publishes, and the board
// draws them into a 32px tile and the bracket into 46px. Measured 16 September:
// 920KB across 39 files, of which roc-esports.png alone was 369KB at 497x717,
// for something that is never painted larger than 46 CSS pixels. A visitor with
// twelve teams on screen was downloading a few hundred kilobytes of artwork to
// render a few thousand pixels of it.
//
// That is bytes, and bytes were not what broke: a burst of REQUESTS is what
// Cloudflare's rate limit counts. But every crest is also a request, they all
// leave at once, and a smaller file clears the connection sooner, so this
// shortens the burst as well as the download.
//
// Encoding runs in Chromium, which is already a dependency for the tracker
// scrape, so this needs no image library. Canvas resampling is bilinear rather
// than Lanczos, which is visibly softer at large reductions - hence RASTER_MAX
// well above the largest drawn size rather than exactly it.
//
// SVG is left alone: it is already resolution independent and smaller than any
// raster version of itself would be.

import { readdir, readFile, writeFile, unlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIR = join(fileURLToPath(new URL("..", import.meta.url)), "web", "img", "teams");

// Longest side, in pixels. The largest tile that draws a crest is the bracket's
// .av.xl at 46px, so this covers a 2.7x display and leaves headroom for a
// bigger tile later without another pass over the artwork.
export const RASTER_MAX = 128;

// WebP at this quality is indistinguishable from the source at 128px on the
// tiles these are drawn in, and roughly a tenth of the PNG.
export const QUALITY = 0.9;

/** Longest side down to max, aspect kept, never enlarged. */
export function fit(w, h, max = RASTER_MAX) {
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** What a file's bytes actually are, whatever the name says. */
export function sniff(buf) {
  const hex = buf.subarray(0, 4).toString("hex");
  if (hex === "89504e47") return "png";
  if (hex.startsWith("ffd8")) return "jpeg";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "webp";
  if (buf.subarray(0, 512).toString().includes("<svg")) return "svg";
  return null;
}

// Run only when invoked directly. Not import.meta.main, which needs Node 22.18
// or 24.2: package.json allows Node 20, where it is undefined and this script
// exited 0 having done nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apply = process.argv.includes("--apply");
  const { chromium } = await import("playwright");

  const files = (await readdir(DIR)).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f));
  const browser = await chromium.launch();
  const page = await browser.newPage();

  let before = 0;
  let after = 0;
  const rows = [];

  for (const file of files) {
    const buf = await readFile(join(DIR, file));
    const kind = sniff(buf);
    if (!kind || kind === "svg") {
      console.log(`${file}: not a raster image, left alone`);
      continue;
    }

    const encoded = await page.evaluate(
      async ({ dataUrl, max, quality }) => {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * scale));
        c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = c.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, c.width, c.height);
        return { url: c.toDataURL("image/webp", quality), w: c.width, h: c.height, sw: img.naturalWidth, sh: img.naturalHeight };
      },
      { dataUrl: `data:image/${kind};base64,${buf.toString("base64")}`, max: RASTER_MAX, quality: QUALITY }
    );

    // A browser that cannot encode WebP hands back a PNG data URL instead of
    // failing, and writing that to a .webp file would ship a mislabelled image
    // to every visitor - which is the mistake ten of these files already carry.
    if (!encoded.url.startsWith("data:image/webp")) {
      throw new Error(`${file}: Chromium did not encode WebP`);
    }

    const out = Buffer.from(encoded.url.split(",")[1], "base64");
    before += buf.length;
    after += out.length;
    rows.push(`${file.padEnd(28)} ${encoded.sw}x${encoded.sh} ${(buf.length / 1024).toFixed(0)}KB -> ${encoded.w}x${encoded.h} ${(out.length / 1024).toFixed(1)}KB`);

    if (apply) {
      const target = file.replace(/\.[^.]+$/, ".webp");
      await writeFile(join(DIR, target), out);
      if (target !== file) await unlink(join(DIR, file));
    }
  }

  await browser.close();
  for (const r of rows) console.log(r);
  console.log(`\n${rows.length} crest(s): ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB`);
  if (!apply) console.log("dry run; pass --apply to write");
  await stat(DIR);
}

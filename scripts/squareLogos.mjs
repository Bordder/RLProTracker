// Pad every team crest onto a square transparent canvas at 256px, centred.
// A wordmark like NRG (128x30) renders seven pixels tall inside a 32px tile and
// a tall mark sits off to one side. object-fit can only centre what it is
// given; making the file square fixes both, and 256 gives retina tiles
// something to work with.
//
// Run this by hand on a crest we are allowed to publish: one that is public
// domain on Wikimedia Commons, from the org's own press kit, or supplied by the
// org. It is deliberately not wired to a workflow. The Liquipedia fetcher that
// used to feed it was removed, because Liquipedia hosts logos under its own
// fair use assertion, which covers Liquipedia and not this site, and a
// dispatchable workflow meant that whole policy was one click from being undone.
// See web/img/teams/sources.json for the basis of each published mark.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { inflateSync, deflateSync, crc32 } from "node:zlib";

const DIR = "web/img/teams";
const CANVAS = 256;

function readPng(buf) {
  let pos = 8, w = 0, h = 0, depth = 0, colorType = 0, interlace = 0;
  let plte = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "PLTE") plte = Buffer.from(data);
    else if (type === "tRNS") trns = Buffer.from(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || ![0, 2, 3, 4, 6].includes(colorType)) return null;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const px = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0, b = prev[i], c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = v & 0xff;
    }
    prev = line;
    for (let x = 0; x < w; x++) {
      const s = x * channels, d = (y * w + x) * 4;
      if (channels === 4) { px[d] = line[s]; px[d + 1] = line[s + 1]; px[d + 2] = line[s + 2]; px[d + 3] = line[s + 3]; }
      else if (channels === 3) { px[d] = line[s]; px[d + 1] = line[s + 1]; px[d + 2] = line[s + 2]; px[d + 3] = 255; }
      else if (channels === 2) { px[d] = px[d + 1] = px[d + 2] = line[s]; px[d + 3] = line[s + 1]; }
      else if (colorType === 3 && plte) {
        const idx = line[s];
        px[d] = plte[idx * 3]; px[d + 1] = plte[idx * 3 + 1]; px[d + 2] = plte[idx * 3 + 2];
        px[d + 3] = trns && idx < trns.length ? trns[idx] : 255;
      }
      else { px[d] = px[d + 1] = px[d + 2] = line[s]; px[d + 3] = 255; }
    }
  }
  return { w, h, px };
}

function scale(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const fx = sw / dw, fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
        const i = (sy * sw + sx) * 4, al = src[i + 3] / 255;
        r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += src[i + 3]; n++;
      }
      const d = (y * dw + x) * 4, aa = a / n, un = aa > 0 ? (n * 255) / a : 0;
      out[d] = Math.round((r / n) * un); out[d + 1] = Math.round((g / n) * un);
      out[d + 2] = Math.round((b / n) * un); out[d + 3] = Math.round(aa);
    }
  }
  return out;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function writePng(px, w, h) {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Trim fully transparent edges first, so a crest with baked-in padding is not
// centred around its own empty space.
function trim(px, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (px[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return { px, w, h };
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const out = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) px.copy(out, y * cw * 4, ((y + y0) * w + x0) * 4, ((y + y0) * w + x0 + cw) * 4);
  return { px: out, w: cw, h: ch };
}

let done = 0, skipped = [];
for (const f of (await readdir(DIR)).filter((f) => /\.png$/i.test(f))) {
  const img = readPng(await readFile(`${DIR}/${f}`));
  if (!img) { skipped.push(f); continue; }
  const t = trim(img.px, img.w, img.h);
  const pad = 0.90;                       // a hair of breathing room inside the tile
  const s = Math.min((CANVAS * pad) / t.w, (CANVAS * pad) / t.h);
  const dw = Math.max(1, Math.round(t.w * s)), dh = Math.max(1, Math.round(t.h * s));
  const scaled = scale(t.px, t.w, t.h, dw, dh);
  const canvas = Buffer.alloc(CANVAS * CANVAS * 4);       // transparent
  const ox = Math.round((CANVAS - dw) / 2), oy = Math.round((CANVAS - dh) / 2);
  for (let y = 0; y < dh; y++)
    scaled.copy(canvas, ((y + oy) * CANVAS + ox) * 4, y * dw * 4, (y + 1) * dw * 4);
  await writeFile(`${DIR}/${f}`, writePng(canvas, CANVAS, CANVAS));
  console.log(`${f.padEnd(26)} ${img.w}x${img.h} -> ${CANVAS}x${CANVAS} (mark ${dw}x${dh})`);
  done++;
}
console.log(`\n${done} crests squared${skipped.length ? `, skipped ${skipped.join(", ")}` : ""}`);

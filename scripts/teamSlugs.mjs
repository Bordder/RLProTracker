// Print the logo slug for every team, and whether a logo file is present.
// Use it when adding files to web/img/teams.  Usage: node scripts/teamSlugs.mjs

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOGO_DIR = join(ROOT, "web", "img", "teams");

// Must match teamSlug() in web/index.html.
export const teamSlug = (name) =>
  String(name || "").toLowerCase()
    .replace(/[’'".]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const teams = JSON.parse(await readFile(join(ROOT, "data", "teams.json"), "utf8")).teams;

let present = [];
try { present = await readdir(LOGO_DIR); } catch {}
const byStem = new Map();
for (const f of present) {
  const dot = f.lastIndexOf(".");
  if (dot > 0) byStem.set(f.slice(0, dot), f.slice(dot + 1));
}

const rows = teams.map((t) => ({ name: t.name, slug: teamSlug(t.name), ext: byStem.get(teamSlug(t.name)) ?? null }));
const w = Math.max(...rows.map((r) => r.name.length));
for (const r of rows) {
  console.log(`${r.name.padEnd(w)}  ${r.slug.padEnd(22)} ${r.ext ? `found .${r.ext}` : "-"}`);
}

const found = rows.filter((r) => r.ext);
console.log(`\n${found.length}/${rows.length} teams have a logo file.`);
if (found.length) {
  console.log("TEAM_LOGO entry for web/index.html:");
  console.log(`  var TEAM_LOGO={${found.map((r) => `'${r.slug}':'${r.ext}'`).join(",")}};`);
}

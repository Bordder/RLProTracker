// Emit a self-contained web/preview-standalone.html with current data inlined,
// so it renders without the local server (for sharing / quick preview).

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const D = join(ROOT, "data", "derived");

const steam = JSON.parse(await readFile(join(D, "steam-hours.json"), "utf8"));
const teams = JSON.parse(await readFile(join(D, "team-hours.json"), "utf8"));
let html = await readFile(join(ROOT, "web", "index.html"), "utf8");

const inject = `<script>window.__RLDATA__=${JSON.stringify({ steam, teams })};</script>`;
html = html.replace("</head>", `${inject}\n</head>`);

await writeFile(join(ROOT, "web", "preview-standalone.html"), html);
console.log("wrote web/preview-standalone.html");

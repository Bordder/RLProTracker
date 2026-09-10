// Post a Discord embed naming the proxies that are not usable.
//
// Lives here rather than inside the workflow because embedding multi-line
// Python in a YAML `run: |` block broke twice on the same rule: a line indented
// less than the block ENDS the block, so the rest is parsed as YAML and the
// whole workflow becomes invalid. A script file has no such trap and can be
// tested locally.
//
// SAFE FOR A PUBLIC LOG. It prints counts and indices only. Addresses go into
// the Discord payload, which is sent, never echoed. The workflow additionally
// calls ::add-mask:: on every endpoint first, so even an accidental print is
// redacted by the runner.
//
// Usage:  node scripts/alertProxies.mjs <probe.json>
//   env:  PROXY_LIST, DISCORD_WEBHOOK, REPO, RUN_URL

import { readFile } from "node:fs/promises";
import { parseProxies } from "./proxies.mjs";
import { postEmbed } from "./discordPost.mjs";

const MEANING = {
  "tunnel-dead": "could not connect at all - the provider's problem, or a stale address in the secret",
  "api-unreachable": "tunnel fine and the site loads, but api.tracker.gg refuses the IP. Reputation, not death: a replacement only helps if the new address is cleaner",
  "cloudflare-blocked": "the API answered 403 or 429",
  "timeout": "too slow to answer",
  "failed": "unclassified failure",
};

const file = process.argv[2];
if (!file) { console.error("usage: alertProxies.mjs <probe.json>"); process.exit(1); }

let probe;
try { probe = JSON.parse(await readFile(file, "utf8")); }
catch (e) { console.log(`no usable probe output (${e.message}); nothing to report`); process.exit(0); }

const failed = probe.failed ?? [];
const total = probe.total ?? 0;
const ok = probe.ok ?? 0;
console.log(`${ok}/${total} usable, failing indices: ${failed.map((f) => f.i).join(", ") || "none"}`);

if (!failed.length) { console.log("all proxies usable; no alert"); process.exit(0); }

// index -> host:port, from the same parser the probe and collector use, so the
// numbering always agrees with data/proxy-use.json.
const endpoints = parseProxies().map((p) => (p?.server ?? "").replace(/^https?:\/\//, "") || "(unparsed)");

const pct = total ? (ok / total) * 100 : 0;
const colour = pct < 50 ? 0xe74c3c : pct < 80 ? 0xe67e22 : 0xf1c40f;

const lines = failed.map((f) => {
  const where = endpoints[f.i] ?? "(unknown)";
  const noAuth = f.noAuth ? "  **credentials did not parse**" : "";
  return `• \`${where}\`  -  ${f.verdict}${noAuth}`;
});

const verdicts = [...new Set(failed.map((f) => f.verdict))];
const notes = verdicts.map((v) => `**${v}** - ${MEANING[v] ?? ""}`).join("\n");

const embed = {
  title: `Proxy health: ${ok} of ${total} usable`,
  url: process.env.RUN_URL || undefined,
  color: colour,
  description:
    failed.length === total
      ? "**Every proxy is failing.** Collection is running on nothing."
      : `${failed.length} of ${total} are not usable for collection.`,
  fields: [
    { name: `Not usable (${failed.length})`, value: lines.join("\n").slice(0, 1024) },
    { name: "What that means", value: notes.slice(0, 1024) },
    {
      name: "Replacing one",
      value:
        "Replace it at the provider, then edit the line **in place** in `local/proxy-check/proxies.txt`, run `make-secret.bat`, and update the `PROXY_LIST` secret. Deleting a line renumbers every index below it, and `data/proxy-use.json` reports by index.",
    },
  ],
  footer: { text: `${process.env.REPO ?? ""}` },
  timestamp: probe.at ?? new Date().toISOString(),
};

await postEmbed(embed);

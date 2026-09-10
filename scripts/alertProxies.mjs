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
import { summarise, MIN_ATTEMPTS } from "./proxyHistory.mjs";

const MEANING = {
  "tunnel-dead": "could not connect at all - the provider's problem, or a stale address in the secret",
  "api-unreachable": "the tunnel is fine and the site loads, but the API call threw with no status. Note this is NOT a 403 or 429, which report as cloudflare-blocked: it covers a refused connection and a block served without CORS headers alike, so on its own it cannot tell reputation from rate limiting",
  "cloudflare-blocked": "the API answered 403 or 429",
  "timeout": "too slow to answer",
  "failed": "unclassified failure",
};

// What the collector actually experienced, as opposed to what one probe saw.
//
// The probe fires a single request per proxy. That is the right test for "can
// this address reach the API right now" and the wrong one for "should I pay to
// replace it": a healthy fleet here fails 20-30% of requests as a matter of
// course, so a single attempt has a real chance of condemning a working proxy.
// On 2026-09-10 one snapshot of three attempts per proxy said three were dead
// while 24 hours of the collector's own traffic said five, and the snapshot was
// the one being believed.
//
// Missing history is not fatal. The probe result still goes out, just without
// the sustained figures, which is exactly what this alert did before.
async function loadHistory() {
  const repo = process.env.REPO || "Bordder/RLProTracker";
  const url = `https://raw.githubusercontent.com/${repo}/data/data/proxy-history.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) { console.log(`proxy-history.json: HTTP ${res.status}; posting without sustained figures`); return null; }
    return summarise(await res.json());
  } catch (e) {
    console.log(`could not read proxy-history.json (${e.message}); posting without sustained figures`);
    return null;
  }
}

const file = process.argv[2];
if (!file) { console.error("usage: alertProxies.mjs <probe.json>"); process.exit(1); }

let probe;
try { probe = JSON.parse(await readFile(file, "utf8")); }
catch (e) { console.log(`no usable probe output (${e.message}); nothing to report`); process.exit(0); }

const failed = probe.failed ?? [];
const total = probe.total ?? 0;
const ok = probe.ok ?? 0;
console.log(`${ok}/${total} usable, failing indices: ${failed.map((f) => f.i).join(", ") || "none"}`);

const history = await loadHistory();
const sustained = new Map((history?.rows ?? []).map((r) => [r.i, r]));
const rateOf = (r) => `${Math.round(r.rate * 100)}% of ${r.attempts}`;

// A proxy the probe happened to catch on a good request can still be visibly
// dying in the collector's own figures, and that case went unreported: this
// alert only ever spoke about what the probe failed. Name those too.
const alsoDying = (history?.rows ?? []).filter((r) => r.state === "dead" && !failed.some((f) => f.i === r.i));

if (!failed.length && !alsoDying.length) { console.log("all proxies usable; no alert"); process.exit(0); }

// index -> host:port, from the same parser the probe and collector use, so the
// numbering always agrees with data/proxy-use.json.
const endpoints = parseProxies().map((p) => (p?.server ?? "").replace(/^https?:\/\//, "") || "(unparsed)");
const addr = (i) => `\`${endpoints[i] ?? `index ${i}`}\``;

const pct = total ? (ok / total) * 100 : 0;
const colour = pct < 50 ? 0xe74c3c : pct < 80 ? 0xe67e22 : 0xf1c40f;

const lines = failed.map((f) => {
  const noAuth = f.noAuth ? "  **credentials did not parse**" : "";
  const s = sustained.get(f.i);
  // The sustained figure is the part worth reading. A probe failure beside
  // "4% of 128" is a blip on a working address; beside "100% of 39" it is a
  // dead one. Those two used to look identical in this message.
  const seen =
    !s ? ""
    : s.state === "unproven" ? `  -  only ${s.attempts} attempts in 24h, too few to judge`
    : `  -  **${rateOf(s)} in 24h**${s.benched ? `, benched ${s.benched}x` : ""}`;
  return `• ${addr(f.i)}  -  ${f.verdict}${seen}${noAuth}`;
});

const verdicts = [...new Set(failed.map((f) => f.verdict))];
const notes = verdicts.map((v) => `**${v}** - ${MEANING[v] ?? ""}`).join("\n") || "See the sustained figures above.";

// Only recommend spending money on addresses the collector's own 24 hours
// agree about. Everything else is "watch it", which costs nothing and is the
// honest answer when the sample is a single request.
const worthReplacing = [...new Set([...failed.map((f) => f.i), ...alsoDying.map((r) => r.i)])]
  .filter((i) => sustained.get(i)?.state === "dead")
  .sort((a, b) => a - b);
const watch = [...new Set(failed.map((f) => f.i))]
  .filter((i) => sustained.get(i)?.state !== "dead")
  .sort((a, b) => a - b);

const advice = !history
  ? "No 24-hour history available, so this is one probe request per proxy and nothing more. Check `data/proxy-history.json` before replacing anything."
  : [
      worthReplacing.length
        ? `**Replace ${worthReplacing.length}:** ${worthReplacing.map(addr).join(", ")} - sustained failure across ${history.runs} runs in the last 24h.`
        : `**Replace nothing yet.** No address has failed enough of the collector's own attempts to justify it (needs ${MIN_ATTEMPTS}+ attempts and 80%+ failure).`,
      watch.length
        ? `**Watch ${watch.length}:** ${watch.map(addr).join(", ")} - the probe failed them, 24h of real traffic has not condemned them.`
        : "",
      "Replace **in place** in `proxies.txt` - never reorder or delete, since the index is how every report identifies a proxy. Then:",
      "```\n(Get-Content proxies.txt) -join ',' | gh secret set PROXY_LIST --repo Bordder/RLProTracker\n```",
    ].filter(Boolean).join("\n");

const embed = {
  title: `Proxy health: ${ok} of ${total} usable${worthReplacing.length ? `, ${worthReplacing.length} to replace` : ""}`,
  url: process.env.RUN_URL || undefined,
  color: colour,
  description:
    failed.length === total && total > 0
      ? "**Every proxy is failing.** Collection is running on nothing."
      : `${failed.length} of ${total} failed the probe.${history ? ` Sustained figures are from ${history.runs} collector runs over ${history.hours}h.` : ""}`,
  fields: [
    { name: `Failed the probe (${failed.length})`, value: (lines.join("\n") || "none").slice(0, 1024) },
    ...(alsoDying.length
      ? [{
          name: `Passed the probe, failing in production (${alsoDying.length})`,
          value: alsoDying
            .map((r) => `• ${addr(r.i)}  -  **${rateOf(r)} in 24h**${r.benched ? `, benched ${r.benched}x` : ""}`)
            .join("\n")
            .slice(0, 1024),
        }]
      : []),
    { name: "What that means", value: notes.slice(0, 1024) },
    { name: "Replace which", value: advice.slice(0, 1024) },
  ],
  footer: { text: `${process.env.REPO ?? ""}` },
  timestamp: probe.at ?? new Date().toISOString(),
};

await postEmbed(embed);

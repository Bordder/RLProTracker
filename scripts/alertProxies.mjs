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
import { summarise, MIN_ATTEMPTS, DEAD_HOURS } from "./proxyHistory.mjs";

const MEANING = {
  "tunnel-dead": "could not connect at all - the provider's problem, or a stale address in the secret",
  "api-unreachable": "the tunnel is fine and the site loads, but the API call threw with no status. NOT a 403 or 429, which report as cloudflare-blocked. Usually a temporary refusal: tracker.gg blocks an address for an hour or so and then releases it, so a probe failure on its own says nothing about whether the proxy is finished",
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
  // The API, not raw: raw's CDN caches for five minutes and ignores query
  // strings, so an hourly alert can easily read a history older than the run
  // that triggered it.
  const url = `https://api.github.com/repos/${repo}/contents/data/proxy-history.json?ref=data`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/vnd.github.raw", "User-Agent": "rlprotracker-alerts", "X-GitHub-Api-Version": "2022-11-28" },
    });
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
// Refused right now, but not across enough hours to be finished. These cost
// nothing to wait out and a replacement to get wrong.
const blockedNow = (history?.rows ?? []).filter((r) => r.state === "blocked");
const rateOf = (r) => `${Math.round(r.rate * 100)}% of ${r.attempts}`;

// One character per hour, oldest first. The shape is the diagnosis: a block
// is a spike between clean hours, a dying address is a run of them, and an
// address that arrived burnt never had a clean hour. An average shows none of
// that, and reading it as if it did is what sent two healthy proxies to be
// replaced on 11 September.
const shapeOf = (r) =>
  (r.hourly ?? [])
    .map((h) => (h.attempts < 5 ? "_" : h.rate >= 0.8 ? "#" : h.rate >= 0.45 ? "+" : h.rate >= 0.15 ? "-" : "."))
    .join("") || "-";

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
    : s.state === "blocked" ? `  -  refused in the current hour, bad in ${s.badHours} of ${s.ratedHours} judged ${s.ratedHours === 1 ? "hour" : "hours"} - below the ${DEAD_HOURS} that means finished`
    : `  -  **${rateOf(s)} in 24h**, bad in ${s.badHours} separate ${s.badHours === 1 ? "hour" : "hours"}`;
  return `• ${addr(f.i)}  \`${s ? shapeOf(s) : "?"}\`  ${f.verdict}${seen}${noAuth}`;
});

const verdicts = [...new Set(failed.map((f) => f.verdict))];
const notes = verdicts.map((v) => `**${v}** - ${MEANING[v] ?? ""}`).join("\n") || "See the sustained figures above.";

// Only recommend spending money on addresses the collector's own 24 hours
// agree about. Everything else is "watch it", which costs nothing and is the
// honest answer when the sample is a single request.
const worthReplacing = [...new Set([...failed.map((f) => f.i), ...alsoDying.map((r) => r.i)])]
  .filter((i) => sustained.get(i)?.state === "dead")
  .sort((a, b) => a - b);
// Blocked addresses get their own line, so keep them out of this one.
const watch = [...new Set(failed.map((f) => f.i))]
  .filter((i) => !["dead", "blocked"].includes(sustained.get(i)?.state))
  .sort((a, b) => a - b);

const advice = !history
  ? "No 24-hour history available, so this is one probe request per proxy and nothing more. Check `data/proxy-history.json` before replacing anything."
  : [
      worthReplacing.length
        ? `**Replace ${worthReplacing.length}:** ${worthReplacing.map(addr).join(", ")} - refused across ${DEAD_HOURS}+ separate hours, so not a passing block.`
        : "**Replace nothing.** No address has been refused across enough separate hours to be finished.",
      blockedNow.length
        ? `**Blocked right now, leave alone (${blockedNow.length}):** ${blockedNow.map((r) => addr(r.i)).join(", ")} - tracker.gg refuses an address for about an hour and then releases it. Measured 11 September: one proxy failed 22 of 22 requests in an hour and was clean the next.`
        : "",
      watch.length
        ? `**Watch ${watch.length}:** ${watch.map(addr).join(", ")} - the probe failed them, 24h of real traffic has not condemned them.`
        : "",
      "Replace **in place** in `proxies.txt` - never reorder or delete, since the index is how every report identifies a proxy. Then:",
      "```\n(Get-Content proxies.txt) -join ',' | gh secret set PROXY_LIST --repo Bordder/RLProTracker\n```",
    ].filter(Boolean).join("\n");

const embed = {
  title: `Proxy health: ${ok} of ${total} passed the probe${worthReplacing.length ? `, ${worthReplacing.length} to replace` : ""}`,
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
            .map((r) => `• ${addr(r.i)}  \`${shapeOf(r)}\`  **${rateOf(r)} in 24h**, bad in ${r.badHours} separate hours`)
            .join("\n")
            .slice(0, 1024),
        }]
      : []),
    { name: "What that means", value: notes.slice(0, 1024) },
    {
      name: "Reading the shape",
      value:
        "One character per hour, oldest first. `.` under 15%  `-` under 45%  `+` under 80%  `#` refused  `_` too little traffic to judge.\n" +
        "`..#.` is a block that already lifted. `###` is an address that is finished. `----` never worked properly and probably arrived burnt.",
    },
    { name: "Replace which", value: advice.slice(0, 1024) },
  ],
  footer: { text: `${process.env.REPO ?? ""}` },
  timestamp: probe.at ?? new Date().toISOString(),
};

await postEmbed(embed);

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

// Only speak up when more than half the fleet is unusable.
//
// Asked for on 11 September, and the measurements support it. Individual
// addresses are refused and released constantly: one proxy failed 22 of 22
// requests for an hour and was clean the next, and the collector simply
// retries elsewhere, so a handful of failures costs nothing and needs nobody
// woken. What actually threatens collection is most of the fleet going at
// once, which is also the only state a person can do anything useful about.
//
// "Unusable" is the union of what the probe just failed and what 24 hours of
// real traffic calls dead or blocked, so a proxy the probe happened to catch
// on a good request still counts if production says otherwise.
const ALERT_ABOVE = Number(process.env.PROXY_ALERT_THRESHOLD ?? 0.5);
const unusable = new Set([
  ...failed.map((f) => f.i),
  ...(history?.rows ?? []).filter((r) => r.state === "dead" || r.state === "blocked").map((r) => r.i),
]);
const share = total ? unusable.size / total : 0;

if (!unusable.size) { console.log("all proxies usable; no alert"); process.exit(0); }
if (share <= ALERT_ABOVE) {
  console.log(
    `${unusable.size}/${total} unusable (${Math.round(share * 100)}%), at or below the ` +
    `${Math.round(ALERT_ABOVE * 100)}% alert threshold; staying quiet. ` +
    `Indices: ${[...unusable].sort((a, b) => a - b).join(", ")}`
  );
  process.exit(0);
}

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

// One compact block instead of five prose fields.
//
// The old message ran to five fields of explanation and was read once and
// then skimmed forever after. What a person actually needs on their phone is:
// how many are fine, which ones are not, and whether to do anything tonight.
// Everything else is in the local report.
const STATE_WORD = { dead: "replace", blocked: "blocked", bad: "poor", unproven: "new", ok: "ok" };

const row = (i, s, verdict) => {
  const shape = s ? shapeOf(s) : "";
  const pct = s && s.state !== "unproven" ? `${String(Math.round(s.rate * 100)).padStart(3)}%` : "  -";
  const word = s ? STATE_WORD[s.state] : verdict ?? "?";
  return `${(endpoints[i] ?? `index ${i}`).padEnd(21)} ${shape.padEnd(12)} ${pct}  ${word}`;
};

// Everything the probe failed, plus anything the history condemns that the
// probe happened to catch on a good request.
const notable = [...new Set([...failed.map((f) => f.i), ...alsoDying.map((r) => r.i)])]
  .map((i) => ({ i, s: sustained.get(i), verdict: failed.find((f) => f.i === i)?.verdict }))
  .sort((a, b) => (b.s?.rate ?? 0) - (a.s?.rate ?? 0));

// This alert only fires when more than half the fleet is down, so "nothing to
// do" is never the right headline on its own: the reader needs to know whether
// that is a fleet-wide refusal, which recovers on its own, or addresses that
// are genuinely finished, which do not.
const mostOfFleet = share >= 0.6;
const action = !history
  ? "No 24h history, so this is one probe request each. Check the local report before replacing anything."
  : worthReplacing.length
    ? `Replace ${worthReplacing.map(addr).join(", ")} - refused ${DEAD_HOURS}+ separate hours, so not a passing block.`
    : mostOfFleet
      ? "Most of the fleet is refused at once, which is tracker.gg rather than the addresses going bad. The collector retries across whatever still answers. Replace nothing; if it still looks like this in a few hours, that is the signal."
      : "Nothing to replace. These are passing blocks and they lift on their own, usually within the hour.";

const embed = {
  title: `Proxies: ${total - unusable.size}/${total} usable - ${Math.round(share * 100)}% of the fleet is down`,
  url: process.env.RUN_URL || undefined,
  color: worthReplacing.length ? 0xe74c3c : blockedNow.length ? 0xe67e22 : 0xf1c40f,
  description: `**${action}**`,
  fields: [
    {
      name: "Needs a look",
      value: ("```\n" + (notable.map((n) => row(n.i, n.s, n.verdict)).join("\n") || "nothing") + "\n```").slice(0, 1024),
    },
    {
      name: "​",
      value: [
        "`.` <15%  `-` <45%  `+` <80%  `#` refused  `_` thin - one char per hour, oldest first",
        history ? `_${history.runs} runs over ${history.hours}h. \`#.\` lifted, \`###\` finished, \`----\` arrived burnt._` : "",
      ].filter(Boolean).join("\n").slice(0, 1024),
    },
  ],
  footer: { text: `${process.env.REPO ?? ""}` },
  timestamp: probe.at ?? new Date().toISOString(),
};

await postEmbed(embed);

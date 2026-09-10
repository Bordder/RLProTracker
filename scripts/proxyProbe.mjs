// One request per proxy, so a dead one is found before it costs a run.
//
// SAFE FOR CI, unlike checkProxies.mjs. It reports an INDEX and a verdict and
// nothing else: never a hostname, never a port, never an exit IP. This repo is
// public, so Actions logs are public with it, and an exit IP is derived at
// runtime and is masked by nothing. Everything printed here is either an
// integer or a fixed string from the list below.
//
// Why this exists. On 2026-09-10, 6 of 15 proxies were failing 100% of their
// requests and nothing said so: the board still filled, because a failed scrape
// is retried on another proxy and matchesPlayed is cumulative. The symptom was
// a third of players missing from each run and a scrape taking 92s. The fleet
// looked healthy in the provider's dashboard, which tests its own tunnels and
// not whether tracker.gg accepts them.
//
// It probes the collector's real path (warm on robots.txt, then one API call)
// rather than loading a profile page, so a pass here means the thing the
// collector actually does works. A profile page is ~2.4 MB; this is ~10 KB.
//
// Usage:  node scripts/proxyProbe.mjs            (human readable)
//         node scripts/proxyProbe.mjs --json     (one JSON object, for CI)

import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { parseProxies, unauthenticatedIndices } from "./proxies.mjs";

chromium.use(stealth());

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ORIGIN = "https://rocketleague.tracker.network";
const WARM_URL = `${ORIGIN}/robots.txt`;
// A long-standing public profile. Any id works; this one is only a probe target,
// and a 404 here would still prove the tunnel and Cloudflare are fine.
const API = "https://api.tracker.gg/api/v2/rocket-league/standard/profile/steam/76561198960239428";
const JSON_OUT = process.argv.includes("--json");
// Local-only: print each endpoint next to its verdict, so a person can see
// which address to replace without cross-referencing an index. Refused in CI
// for the same reason checkProxies.mjs is: this repo is public, so an Actions
// log is public, and the list is the whole fleet.
const SHOW_ADDRESSES = process.argv.includes("--show-addresses");
if (SHOW_ADDRESSES && process.env.CI && process.env.ALLOW_CI_PROXY_DUMP !== "1") {
  console.error("--show-addresses prints proxy endpoints, and this repo's Actions logs are public. Run it locally.");
  process.exit(1);
}

// Every verdict is one of these fixed strings. Nothing derived from the proxy
// itself is ever emitted, so no address can leak through an error message.
const VERDICT = {
  ok: "ok",
  tunnel: "tunnel-dead",        // could not open a connection at all
  blocked: "cloudflare-blocked", // tunnel fine, tracker.gg refused the IP
  apiblocked: "api-unreachable",  // tunnel fine, site loads, api.tracker.gg will not answer
  slow: "timeout",
  other: "failed",
};

const proxies = parseProxies();
if (!proxies.length) {
  const msg = "no proxies configured (PROXY_LIST empty)";
  console.log(JSON_OUT ? JSON.stringify({ error: msg, total: 0, failed: [] }) : msg);
  process.exit(0);
}

// A four-field entry mistyped into two parses cleanly, keeps its slot, and then
// fails auth on every attempt - indistinguishable from a dead tunnel. Report it
// by index so it is not mistaken for one.
const noAuth = unauthenticatedIndices(proxies);

const classify = (msg) => {
  const m = String(msg ?? "");
  // Any net:: code means Chromium could not complete the request through this
  // proxy, which for our purposes is a dead tunnel whatever the specific code.
  // ERR_TIMED_OUT is the one a wrong host or port actually produces, and it is
  // easy to miss: the underscore form does not match a /timed out/ pattern.
  if (/net::ERR_|Failed to fetch|ECONN|socket hang up|EAI_AGAIN/i.test(m)) return VERDICT.tunnel;
  if (/timeout|timed out|aborted/i.test(m)) return VERDICT.slow;
  return VERDICT.other;
};

const browser = await chromium.launch({ headless: true });
const rows = [];

for (const [i, proxy] of proxies.entries()) {
  let ctx;
  let verdict = VERDICT.other;
  let warmed = false;
  let ms = null;
  const t0 = Date.now();
  try {
    ctx = await browser.newContext({ proxy, userAgent: UA, viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.route("**/*", (r) =>
      ["image", "media", "font", "stylesheet"].includes(r.request().resourceType()) ? r.abort() : r.continue()
    );
    await page.goto(WARM_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    // Past this point the tunnel is proven: the site's own origin answered
    // through it. Anything that fails now is about the API host, not the proxy
    // being dead, and saying "tunnel-dead" here sends someone off to replace
    // working hardware. Measured 2026-09-10: five residential proxies loaded
    // robots.txt fine and every one of them threw on the API call.
    warmed = true;
    const status = await page.evaluate(async (u) => {
      try {
        const res = await fetch(u, { credentials: "include", headers: { accept: "application/json" } });
        return res.status;
      } catch (e) {
        return `ERR:${e.message}`;
      }
    }, API);
    if (typeof status === "number") {
      // 200 is a pass. 404 also proves the path works end to end; only the
      // profile was missing, which is not this proxy's problem.
      if (status === 200 || status === 404) verdict = VERDICT.ok;
      else if (status === 403 || status === 429) verdict = VERDICT.blocked;
      else verdict = VERDICT.other;
    } else {
      verdict = warmed ? VERDICT.apiblocked : classify(status);
    }
  } catch (e) {
    verdict = warmed ? VERDICT.apiblocked : classify(e?.message);
  } finally {
    ms = Date.now() - t0;
    await ctx?.close().catch(() => {});
  }
  rows.push({ i, verdict, ms, noAuth: noAuth.includes(i) });
  if (!JSON_OUT) {
    const where = SHOW_ADDRESSES ? `  ${proxy.server.replace(/^https?:\/\//, "").padEnd(22)}` : "";
    const mark = verdict === VERDICT.ok ? "  OK  " : " DEAD ";
    console.log(`  index ${String(i).padStart(2)} ${mark}${where} ${verdict.padEnd(19)} ${ms} ms${noAuth.includes(i) ? "  (no credentials parsed)" : ""}`);
  }
}

await browser.close();

const failed = rows.filter((r) => r.verdict !== VERDICT.ok);
const summary = {
  at: new Date().toISOString(),
  total: rows.length,
  ok: rows.length - failed.length,
  failed: failed.map((r) => ({ i: r.i, verdict: r.verdict, noAuth: r.noAuth })),
  noAuthIndices: noAuth,
};

if (JSON_OUT) {
  console.log(JSON.stringify(summary));
} else {
  console.log(`\n${summary.ok}/${summary.total} proxies usable on tracker.gg`);
  if (failed.length) {
    console.log(`failing indices: ${failed.map((r) => r.i).join(", ")}`);
    if (SHOW_ADDRESSES) {
      console.log("replace these:");
      for (const r of failed) console.log(`  ${proxies[r.i].server.replace(/^https?:\/\//, "")}   ${r.verdict}`);
    }
    console.log("Indices are positions in PROXY_LIST, the same ones data/proxy-use.json reports.");
    console.log("Replace entries in place: deleting one renumbers every index below it.");
  }
}

// Always exit 0. Whether a failure is worth waking someone is the workflow's
// decision, and a non-zero exit here would show as a broken job rather than a
// broken proxy.
process.exit(0);

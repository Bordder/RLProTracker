// Check every configured proxy: is the tunnel alive, what IP does it exit from,
// and does tracker.gg accept it? Reads the same env vars as the scraper, so it
// tells you which endpoints are actually usable right now.
//
// RUN THIS LOCALLY ONLY. It prints each proxy's host:port and the public IP it
// exits from, which is the whole point of the tool and exactly what must never
// reach a workflow log: this repo is public, so Actions logs are readable by
// anyone. GitHub masks values that match a secret exactly, but an exit IP is not
// a secret and would be masked by nothing. Everything the collector itself
// prints or commits is proxy INDICES only, and it stays that way.
//
// The guard below refuses to run in CI for that reason. If a run there is ever
// genuinely needed, set ALLOW_CI_PROXY_DUMP=1 and understand that the output is
// public forever.
//
// Usage:  node scripts/checkProxies.mjs
//   PROXY_LIST="host:port:user:pass,..."   or
//   PROXY_HOST=... PROXY_PORTS=1,2,3 PROXY_USER=... PROXY_PASS=...

import { parseProxies } from "./proxies.mjs";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
chromium.use(stealth());

if (process.env.CI && process.env.ALLOW_CI_PROXY_DUMP !== "1") {
  console.error(
    "checkProxies prints proxy endpoints and exit IPs, and this repo's Actions logs are public.\n" +
    "Run it locally. To override anyway, set ALLOW_CI_PROXY_DUMP=1."
  );
  process.exit(1);
}

const TEST_URL = "https://rocketleague.tracker.network/rocket-league/profile/steam/76561198960239428/overview";
const IP_URL = "https://api.ipify.org?format=json";

const proxies = parseProxies();
if (!proxies.length) {
  // The values live in GitHub Actions secrets, which are write-only: they
  // cannot be read back out of GitHub, so they have to come from wherever they
  // were kept when they were set (the provider's dashboard, a password
  // manager). Say that here rather than leaving someone hunting for a settings
  // page that will never show them.
  console.error(
    "No proxies configured in this shell.\n" +
    "\n" +
    "  PROXY_LIST='host:port:user:pass,...' node scripts/checkProxies.mjs\n" +
    "or\n" +
    "  PROXY_HOST=... PROXY_PORTS=1,2,3 PROXY_USER=... PROXY_PASS=... node scripts/checkProxies.mjs\n" +
    "\n" +
    "These are Actions secrets in CI and GitHub will not show them again, so use\n" +
    "your own copy. Add --list to print the index of each one without testing it."
  );
  process.exit(1);
}

// --list answers "which proxy is index 8?" on its own. Mapping an index to an
// endpoint needs no network calls, and separating it means the answer is
// instant rather than a browser launch and fifteen page loads away.
if (process.argv.includes("--list")) {
  console.log("index  endpoint            (order comes from the secret; appending is safe, inserting renumbers)");
  proxies.forEach((p, i) => console.log(`  ${String(i).padStart(3)}  ${p.server.replace(/^http:\/\//, "")}`));
  process.exit(0);
}

console.log(`testing ${proxies.length} proxies. Indices below are the ones data/proxy-use.json reports.\n`);
const browser = await chromium.launch({ headless: true });
const results = [];

for (const [i, proxy] of proxies.entries()) {
  const label = proxy.server.replace(/^http:\/\//, "");
  const row = { label, tunnel: "?", exitIp: "-", tracker: "-", ms: 0 };
  let ctx;
  try {
    ctx = await browser.newContext({ proxy, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" });
    const page = await ctx.newPage();

    // 1. is the tunnel alive, and what IP do we exit from?
    const t0 = Date.now();
    try {
      const r = await page.goto(IP_URL, { timeout: 20000 });
      row.exitIp = JSON.parse(await r.text()).ip;
      row.tunnel = "alive";
    } catch (e) {
      row.tunnel = e.message.match(/net::(\w+)/)?.[1] ?? e.message.slice(0, 30);
      results.push(row); await ctx.close(); continue;
    }
    row.ms = Date.now() - t0;

    // 2. does tracker.gg serve us, or does Cloudflare reject this IP?
    try {
      const r = await page.goto(TEST_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      const status = r.status();
      const ok = await page.evaluate(() => !!window.__INITIAL_STATE__?.stats?.standardProfiles);
      row.tracker = status === 200 ? (ok ? "OK (data present)" : `200 but no data`) : `HTTP ${status}`;
    } catch (e) {
      row.tracker = e.message.match(/net::(\w+)/)?.[1] ?? e.message.slice(0, 30);
    }
  } catch (e) {
    row.tunnel = e.message.slice(0, 40);
  } finally { await ctx?.close(); }
  results.push(row);
  console.log(`  index ${String(i).padStart(2)}  ${label.padEnd(24)} tunnel=${row.tunnel.padEnd(22)} exit=${row.exitIp.padEnd(16)} tracker=${row.tracker}`);
}

await browser.close();
const alive = results.filter((r) => r.tunnel === "alive");
const usable = results.filter((r) => r.tracker.startsWith("OK"));
console.log(`\n${alive.length}/${results.length} tunnels alive, ${usable.length}/${results.length} actually usable on tracker.gg`);
if (alive.length && !usable.length) console.log("Tunnels work but tracker.gg rejects every IP - that is the datacenter-IP problem, not a dead subscription.");
if (!alive.length) console.log("No tunnel opened at all - credentials, endpoint, or subscription.");

// Post a Discord embed when the collector's scrape success rate drops.
//
// The gap every other alarm leaves. Staleness watches whether data is
// ARRIVING; this watches whether it is COMPLETE, and they are different
// questions. A failed player is retried next run and matchesPlayed is
// cumulative, so the feed publishes on time while most of the board goes
// unread and the numbers quietly age.
//
// Measured 2026-09-10: the fleet sat at 72-80% failure from at least 14:53,
// reached 89% by 20:13 with 14 of 15 proxies failing every attempt, and nothing
// said a word. It was found by hand.
//
// Reads data/proxy-use.json from the data branch, which real collector traffic
// already writes every couple of minutes, so it costs one request and puts no
// load on the proxies at all.
//
// Prints counts only, never an address.
//
// Usage:  node scripts/alertScrapeRate.mjs
//   env:  REPO, DISCORD_WEBHOOK, RUN_URL, FAIL_PCT (default 50)

const REPO = process.env.REPO ?? "Bordder/RLProTracker";
const THRESHOLD = Number(process.env.FAIL_PCT ?? 50);
const URL = `https://raw.githubusercontent.com/${REPO}/data/data/proxy-use.json`;

let d;
try {
  const res = await fetch(URL, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) { console.log(`proxy-use.json: HTTP ${res.status}; skipping`); process.exit(0); }
  d = await res.json();
} catch (e) {
  console.log(`could not read proxy-use.json (${e.message}); skipping`);
  process.exit(0);
}

const use = d.use ?? [];
const attempts = use.reduce((a, x) => a + (x.attempts ?? 0), 0);
const fails = use.reduce((a, x) => a + (x.fails ?? 0), 0);
const dead = use.filter((x) => x.attempts && x.fails === x.attempts).length;
const total = d.proxyCount ?? use.length;

if (!attempts) { console.log("no attempts recorded in the last run; skipping"); process.exit(0); }

const pct = Math.round((fails / attempts) * 100);
console.log(`scrape failure ${pct}%, ${dead}/${total} proxies failing every attempt, as of ${d.at}`);

if (pct < THRESHOLD) { console.log(`below the ${THRESHOLD}% threshold; no alert`); process.exit(0); }

const embed = {
  title: `Collection degraded: ${pct}% of scrapes failing`,
  url: process.env.RUN_URL || undefined,
  color: pct >= 80 ? 0xe74c3c : 0xe67e22,
  description:
    "Data is still publishing on time, so the freshness alarms stay green - but most of the board is going unread and the numbers are ageing.",
  fields: [
    { name: "Failure rate", value: `${pct}% of ${attempts} attempts`, inline: true },
    { name: "Proxies failing every attempt", value: `${dead} of ${total}`, inline: true },
    { name: "Players in the run", value: `${d.players ?? "?"}`, inline: true },
    {
      name: "Where to look",
      value:
        "The **Proxy health** workflow gives a per-proxy verdict with addresses. `api-unreachable` means the tunnel is fine and the IP is refused, which is reputation rather than a dead proxy.",
    },
  ],
  footer: { text: `${REPO} - measured from real collector traffic, not a probe` },
  timestamp: d.at ?? new Date().toISOString(),
};

const hook = process.env.DISCORD_WEBHOOK;
if (!hook) { console.log("DISCORD_WEBHOOK not set; nothing sent"); process.exit(0); }

const res = await fetch(hook, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ embeds: [embed] }),
});
console.log(`discord responded ${res.status}`);
if (res.status !== 204) console.log((await res.text()).slice(0, 300));

// Warn when the deployed site is behind main.
//
// The second axis of staleness. Every other alarm follows the DATA - collector
// output on the `data` branch, read through /api/status. This follows the CODE
// visitors are running. On 2026-09-10 main carried a day of shipped work nobody
// could see: it was pushed, but only `wrangler pages deploy` moves the page.
//
// It NEVER deploys and NEVER pushes. Deploys stay manual on purpose so a
// release is checked before it is public; what was missing was only that a
// forgotten one said nothing.
//
// Lives here rather than inside the workflow because multi-line Python in a
// YAML `run: |` block broke the whole file twice: a line indented less than the
// block ends the block, and the rest is parsed as YAML. liveness.yml was
// invalid for hours before anyone noticed, which is exactly the sort of silent
// failure these alarms exist to prevent.
//
// Usage:  node scripts/alertBuildBehind.mjs
//   env:  REPO, MAIN_SHA, GH_TOKEN, DISCORD_WEBHOOK, RUN_URL, SITE (optional),
//         BEHIND_MINUTES (default 90)

import { postEmbed } from "./discordPost.mjs";

const REPO = process.env.REPO ?? "Bordder/RLProTracker";
const SITE = process.env.SITE ?? "https://198x.online";
const GRACE = Number(process.env.BEHIND_MINUTES ?? 90);
const MAIN = process.env.MAIN_SHA ?? "";

const j = async (url, init) => {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

let stamp;
try {
  stamp = await j(`${SITE}/build.json?t=${Date.now()}`);
} catch {
  // Predates the stamp, or the deploy did not include it. Nothing to compare,
  // so say so and stay quiet rather than guessing.
  console.log("no build stamp on the live site; skipping");
  process.exit(0);
}

const deployed = stamp.commit;
if (!deployed) { console.log("build stamp carries no commit; skipping"); process.exit(0); }
if (!MAIN) { console.log("MAIN_SHA not provided; skipping"); process.exit(0); }
if (deployed === MAIN) { console.log(`deployed build is main (${MAIN.slice(0, 9)})`); process.exit(0); }

let cmp;
try {
  cmp = await j(`https://api.github.com/repos/${REPO}/compare/${deployed}...${MAIN}`, {
    headers: {
      accept: "application/vnd.github+json",
      ...(process.env.GH_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN}` } : {}),
    },
  });
} catch (e) {
  console.log(`compare failed (${e.message}); skipping`);
  process.exit(0);
}

// ahead_by counts commits from the deployed one up to main. It is 0 when the
// deploy is AHEAD of main - a deploy from an unpushed commit - which is not
// staleness and must not warn.
const ahead = cmp.ahead_by ?? 0;
if (ahead < 1) { console.log(`deployed ${deployed.slice(0, 9)} is not behind main`); process.exit(0); }

// Only commits that change what is SERVED need a deploy. Collector config,
// scripts, workflows and tests reach production by being pushed, so counting
// them would fire on the majority of commits and train everyone to ignore it.
const files = cmp.files ?? [];
const shipped = files.filter((f) => /^(web|functions)\//.test(f.filename ?? ""));
if (!shipped.length) {
  console.log(`the ${ahead} undeployed commit(s) touch nothing under web/ or functions/; no deploy needed`);
  process.exit(0);
}

// Age of the oldest undeployed commit, so a warning means "this has been
// sitting" rather than "you pushed 40 seconds ago".
const first = cmp.commits?.[0]?.commit?.committer?.date;
const ageMin = first ? Math.floor((Date.now() - Date.parse(first)) / 60000) : 0;
console.log(`deployed ${deployed.slice(0, 9)} is ${ahead} commit(s) behind, ${shipped.length} served file(s), oldest ${ageMin} min`);
if (ageMin < GRACE) { console.log(`within the ${GRACE} min grace`); process.exit(0); }

const embed = {
  title: `Site is ${ahead} commit(s) behind main`,
  url: process.env.RUN_URL || undefined,
  color: 0x3498db,
  description: "Work is pushed but not deployed, so visitors are not seeing it. Data is unaffected - this is the code, not the numbers.",
  fields: [
    { name: "Undeployed commits", value: `${ahead}`, inline: true },
    { name: "Changed files that ship", value: `${shipped.length}`, inline: true },
    { name: "Oldest waiting", value: `${ageMin} min`, inline: true },
    { name: "To deploy", value: "```\nnpm run build:site\nnpx wrangler pages deploy web --project-name=rlprotracker --branch=main\n```" },
  ],
  footer: { text: `${REPO} - deployed ${deployed.slice(0, 9)}, main ${MAIN.slice(0, 9)}` },
  timestamp: new Date().toISOString(),
};

await postEmbed(embed);

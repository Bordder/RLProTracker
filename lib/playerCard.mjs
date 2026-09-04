// One player, rendered server-side as a shareable page.
//
// Why this is a Function and not a route in the single-page board: the whole
// point of the card is that someone pastes the link into Discord or Twitter and
// a preview appears. Crawlers do not run JavaScript, so og: tags have to be in
// the HTML that comes back from the origin. A "?p=zen" query on the board would
// preview as the board.
//
// Prerendering a file per player at build time would also satisfy crawlers, but
// the numbers change every few minutes, so every player's file would be
// rewritten on every collector run - the same committed-data growth that
// tracker-history.json was just cut down from. Rendering per request keeps the
// repo flat and the numbers current.

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Colour comes from the tier the API reports, not from the MMR number.
//
// The two disagree, and the label wins: rank cutoffs are per playlist, so
// Atomic's 1,216 is Grand Champion I in 1v1 while the same number in 2v2 is
// nowhere near it. Colouring off a single set of MMR bands painted that cell
// Champion blue underneath a "Grand Champion I" label.
export function tierClass(label) {
  const s = String(label || "");
  if (/^Supersonic/i.test(s)) return "t-ssl";
  if (/^Grand Champion/i.test(s)) return "t-gc";
  if (/^Champion/i.test(s)) return "t-champ";
  return "t-low";
}

export function initials(s) {
  s = String(s || "").trim();
  if (!s) return "?";
  const p = s.split(/[\s\-_.]+/).filter(Boolean);
  return (p.length > 1 ? p[0][0] + p[1][0] : s.slice(0, 2)).toUpperCase();
}

export const teamSlug = (name) =>
  String(name || "").toLowerCase().replace(/[’'".]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Kept in step with web/rlpt.js TEAM_LOGO. Only teams whose mark we are allowed
// to publish appear here; everyone else gets a monogram. See
// web/img/teams/sources.json for the basis of each one.
export const TEAM_LOGO = {
  "geng-mobil1-racing": "png", "karmine-corp": "png", "lil-step-bros": "png", "mibr": "png",
  "nrg": "png", "shopify-rebellion": "png", "spacestation-gaming": "png", "tsm": "png",
};

// An absent number is a middot, matching the board, not a zero and not a dash
// that could be read as a minus in a column of MMR values.
const num = (n) => (n == null ? '<span class="none">&middot;</span>' : Number(n).toLocaleString("en-GB"));

function ago(ms, now) {
  if (ms == null || Number.isNaN(ms)) return null;
  const m = Math.max(0, Math.round((now - ms) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

function durWords(mins) {
  if (mins == null) return "";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// A session counts as live on the same rule the board uses: games seen inside
// the last 30 minutes. Anything older is "last played", not "playing".
const LIVE_MS = 30 * 60e3;

export function isLive(p, now) {
  const t = p?.lastPlayedAt ? Date.parse(p.lastPlayedAt) : null;
  return t != null && now - t < LIVE_MS;
}

// The one sentence the card exists to be shared as. Games lead, because ranked
// games are known for every tracked player regardless of their Steam privacy,
// where hours are blank for a third of the roster.
export function claimLine(p, now) {
  const live = isLive(p, now);
  if (live && p.session?.games) {
    const mins = Math.round((now - Date.parse(p.session.startedAt)) / 60000);
    return `Playing ranked right now: ${p.session.games} ${p.session.games === 1 ? "game" : "games"} in ${durWords(mins)}`;
  }
  const d1 = p.games?.total?.d1?.games ?? null;
  if (d1 != null && d1 > 0) return `${d1} ranked ${d1 === 1 ? "game" : "games"} in the last 24 hours`;
  const d7 = p.games?.total?.d7?.games ?? null;
  if (d7 != null && d7 > 0) return `${d7} ranked ${d7 === 1 ? "game" : "games"} in the last 7 days`;
  const last = p.lastPlayedAt ? ago(Date.parse(p.lastPlayedAt), now) : null;
  return last ? `No ranked games in 24 hours. Last played ${last}` : "No ranked games recorded yet";
}

// og:description carries no markup, so it needs the plain-text form of the claim.
const plain = (s) => s.replace(/&amp;/g, "&");

function statCell(label, value, extra = "") {
  return `<div class="st"><span class="k">${label}</span><span class="v ${extra}">${value}</span></div>`;
}

function mmrCell(label, v, tierLabel) {
  const sub = v == null ? "Not played" : esc(tierLabel || "Unranked");
  return `<div class="st"><span class="k">${label}</span><span class="v ${tierClass(tierLabel)}">${num(v)}</span>` +
    `<span class="sub">${sub}</span></div>`;
}

function gamesCell(label, w) {
  const g = w?.games ?? null;
  // "partial" means the window is longer than the history we hold, so the count
  // is a floor rather than a total. Saying so is the difference between a number
  // that is wrong and a number that is honest.
  const mark = w?.partial && g != null
    ? `<span class="pt" title="Tracking has not covered this whole window yet, so this is a minimum">+</span>`
    : "";

  return `<div class="st"><span class="k">${label}</span><span class="v">${num(g)}${mark}</span></div>`;
}

export function renderCard({ player, hours, origin, computedAt, now = Date.now() }) {
  const p = player;
  const live = isLive(p, now);
  const claim = claimLine(p, now);
  const slug = teamSlug(p.team);
  const ext = TEAM_LOGO[slug];
  const title = `${p.name} - ${plain(claim)}`;
  const desc = `${p.name} of ${p.team}. ${plain(claim)}. Ranked ladder activity for RLCS pros outside official tournaments.`;
  const url = `${origin}/p/${encodeURIComponent(p.id)}`;
  // Hours are blank for every player who hides their Steam game details, which
  // is a third of the roster. Three empty cells read as a broken card, so the
  // block is dropped entirely and the note says why instead.
  const hoursWin = hours?.windows ?? null;
  const hasHours = hoursWin ? ["d1", "d7", "d14"].some((k) => hoursWin[k]?.hours != null) : false;

  const mark = ext
    ? `<span class="av logo"><img src="/img/teams/${esc(slug)}.${esc(ext)}" alt=""></span>`
    : `<span class="av">${esc(initials(p.team))}</span>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} &middot; RL Pro Tracker</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="RL Pro Tracker">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(origin)}/share.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(origin)}/share.png">
<meta name="theme-color" content="#0C0E13">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="preload" href="/fonts/archivo-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/big-shoulders-display-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/fonts/fonts.css">
<style>
  :root{
    --ink:#0C0E13; --surface:#14171F; --panel2:#191d27;
    --bone:#F2EFE6; --slate:#8B90A0; --dim:#565E6A;
    --accent:#FF5A1F; --line:#262B36; --line2:#2E3441; --playing:#5EC8FF;
    --t-low:#6A7482; --t-champ:#5AA0E0; --t-gc:#D98A5A; --t-ssl:#FF6A3D;
    --display:'Big Shoulders Display','Arial Narrow',system-ui,sans-serif;
    --body:'Archivo',system-ui,-apple-system,'Segoe UI',sans-serif;
    --mono:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;
  }
  *{box-sizing:border-box}
  html,body{margin:0;background:var(--ink)}
  ::selection{background:var(--accent);color:var(--ink)}
  body{color:var(--bone);font-family:var(--body);font-size:14px;line-height:1.45;
    -webkit-font-smoothing:antialiased;
    background-image:repeating-linear-gradient(115deg,rgba(255,90,31,.016) 0 2px,transparent 2px 26px)}
  a{color:inherit}
  .wrap{max-width:760px;margin:0 auto;padding:22px 20px 56px}
  .kick{display:flex;align-items:center;justify-content:space-between;gap:12px;
    font-family:var(--display);font-size:.72rem;letter-spacing:.22em;text-transform:uppercase;
    color:var(--slate);border-bottom:1px solid var(--line);padding-bottom:10px}
  .kick a{text-decoration:none;color:var(--bone);font-weight:700;letter-spacing:.14em}
  .kick .up{font-family:var(--mono);letter-spacing:.04em;font-size:10.5px;color:var(--dim);text-transform:none}

  .hero{display:flex;align-items:center;gap:16px;margin:26px 0 0}
  .av{width:56px;height:56px;flex:none;border-radius:12px;background:var(--panel2);
    border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;
    font-family:var(--display);font-weight:800;font-size:20px;color:var(--slate);overflow:hidden}
  .av img{width:100%;height:100%;object-fit:contain;padding:6px}
  .who{min-width:0}
  h1{font-family:var(--display);font-weight:900;text-transform:uppercase;
    font-size:clamp(2.4rem,8vw,4.4rem);line-height:.86;letter-spacing:-.02em;margin:0;
    overflow-wrap:anywhere}
  .team{color:var(--slate);font-size:15px;margin-top:7px;display:flex;align-items:center;gap:9px;flex-wrap:wrap}
  .plive{font-family:var(--display);text-transform:uppercase;letter-spacing:.12em;font-size:10px;
    font-weight:700;color:var(--playing);border:1px solid rgba(94,200,255,.4);
    background:rgba(94,200,255,.1);border-radius:4px;padding:3px 7px;display:inline-flex;align-items:center;gap:5px}
  .plive::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--playing)}

  .claim{margin:22px 0 0;padding:16px 18px;border:1px solid var(--line2);border-left:3px solid var(--accent);
    border-radius:8px;background:var(--surface);font-size:clamp(1.05rem,2.6vw,1.35rem);
    font-weight:600;line-height:1.35}
  .claim.live{border-left-color:var(--playing)}

  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(122px,1fr));gap:10px;margin-top:12px}
  .st{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:12px 13px}
  .k{display:block;font-family:var(--display);text-transform:uppercase;letter-spacing:.13em;
    font-size:10.5px;font-weight:600;color:var(--slate)}
  .v{display:block;font-family:var(--mono);font-variant-numeric:tabular-nums;font-weight:600;
    font-size:23px;line-height:1;margin-top:9px;letter-spacing:-.01em}
  .sub{display:block;font-size:11px;color:var(--dim);margin-top:7px}
  .pt{color:var(--dim);margin-left:1px}
  .none{color:var(--dim)}
  .t-low{color:var(--t-low)} .t-champ{color:var(--t-champ)} .t-gc{color:var(--t-gc)} .t-ssl{color:var(--t-ssl)}
  .sec{font-family:var(--display);text-transform:uppercase;letter-spacing:.15em;font-size:11px;
    color:var(--slate);margin:24px 0 0;border-top:1px solid var(--line);padding-top:14px}

  .foot{margin-top:26px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .btn{appearance:none;font:inherit;font-size:13px;font-weight:600;cursor:pointer;
    background:var(--surface);color:var(--bone);border:1px solid var(--line2);
    border-radius:7px;padding:9px 15px;text-decoration:none;display:inline-block}
  .btn:hover{border-color:var(--accent)}
  .btn.pri{background:var(--accent);color:#160903;border-color:var(--accent)}
  .note{color:var(--dim);font-size:12px;margin-top:18px;line-height:1.55}
  @media (max-width:420px){ .grid{grid-template-columns:repeat(2,1fr)} }
</style>
</head>
<body>
<div class="wrap">
  <div class="kick"><a href="/">RL Pro Tracker</a><span class="up">Updated ${esc(ago(Date.parse(computedAt), now) || "")}</span></div>

  <div class="hero">
    ${mark}
    <div class="who">
      <h1>${esc(p.name)}</h1>
      <div class="team">${esc(p.team)}${live ? '<span class="plive">Playing</span>' : ""}</div>
    </div>
  </div>

  <p class="claim${live ? " live" : ""}">${claim}</p>

  <div class="sec">Ranked games</div>
  <div class="grid">
    ${gamesCell("24 hours", p.games?.total?.d1)}
    ${gamesCell("7 days", p.games?.total?.d7)}
    ${gamesCell("14 days", p.games?.total?.d14)}
    ${statCell("This season", num(p.seasonGames?.total))}
  </div>

  <div class="sec">MMR</div>
  <div class="grid">
    ${mmrCell("1v1", p.mmr?.ones, p.tier?.ones)}
    ${mmrCell("2v2", p.mmr?.twos, p.tier?.twos)}
    ${mmrCell("3v3", p.mmr?.threes, p.tier?.threes)}
  </div>

  ${hasHours ? `<div class="sec">Hours in game</div>
  <div class="grid">
    ${statCell("24 hours", hoursWin.d1?.hours != null ? hoursWin.d1.hours.toFixed(1) : '<span class="none">&middot;</span>')}
    ${statCell("7 days", hoursWin.d7?.hours != null ? hoursWin.d7.hours.toFixed(1) : '<span class="none">&middot;</span>')}
    ${statCell("14 days", hoursWin.d14?.hours != null ? hoursWin.d14.hours.toFixed(1) : '<span class="none">&middot;</span>')}
  </div>` : ""}

  <div class="foot">
    <button class="btn pri" id="copy" data-url="${esc(url)}">Copy link</button>
    <a class="btn" href="/">See the whole board</a>
  </div>

  <p class="note">Ranked games come from the public match tracker, so they cover every tracked player
  whatever their Steam privacy settings.${hasHours
    ? " Hours come from Steam."
    : ` ${esc(p.name)} hides their Steam game details, so hours in game cannot be measured.`}${
    p.lastPlayedAt ? ` Last ranked game ${esc(ago(Date.parse(p.lastPlayedAt), now))}.` : ""}</p>
</div>
<script src="/card.js"></script>
</body>
</html>`;
}

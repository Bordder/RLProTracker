// Head to head: two tracked players side by side.
//
// Everything here is read from feeds the board already publishes, so this page
// adds no collection and no new facts. The board's merged document gives the
// numbers in one request; the rating history is a second, larger file and is
// only fetched once the first has painted.
//
// The pair lives in the address bar as ?p=Name,Name, the same shape the
// ratings tab uses for its lines, so a comparison is a link someone can post.

import { crest, assignHues, teamName } from "/crest.mjs?v=3d51b913";
import { flagSVG } from "/flags.mjs?v=d67b29cc";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = (n) => (n == null ? null : Math.round(n).toLocaleString("en-GB"));

// Same one-minute bucket the board uses, so both pages share a cached copy.
const getJson = (f) =>
  fetch(`/data/${f}?v=${Math.floor(Date.now() / 60000)}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

const PLAYLISTS = [["ones", "1v1"], ["twos", "2v2"], ["threes", "3v3"]];
const LIVE_MS = 10 * 60e3;

const ago = (t) => {
  if (t == null) return null;
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 0) return null;
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
};
const ms = (iso) => {
  const v = iso ? Date.parse(iso) : NaN;
  return isNaN(v) ? null : v;
};

let players = [];
let byId = new Map();
let collectedAt = null;
let history = null;      // mmr-history.json, once it arrives
let historyFailed = false;
let chartPl = "twos";
let pair = [null, null]; // two player ids

// ---- data --------------------------------------------------------------------

function buildPlayers(board) {
  const tracker = board?.["tracker.json"];
  const steam = board?.["steam-hours.json"];
  const pres = board?.["presence-hours.json"];
  if (!tracker?.players) return [];
  collectedAt = ms(tracker.computedAt);
  const list = Array.isArray(tracker.players) ? tracker.players : Object.values(tracker.players);
  const steamById = new Map((steam?.players ?? []).map((p) => [p.id, p]));
  const presById = new Map((pres?.players ?? []).map((p) => [p.id, p]));
  return list.map((t) => {
    const s = steamById.get(t.id) ?? {};
    const e = presById.get(t.id);
    const measured = s.steam2wkHours ?? null;
    return {
      id: t.id,
      name: t.name,
      team: t.team ?? null,
      country: t.country ?? null,
      twitch: t.twitch ?? null,
      mmr: t.mmr ?? {},
      tier: t.tier ?? {},
      peak: t.peak ?? {},
      season: t.seasonGames ?? {},
      games: t.games ?? {},
      lastPlayedAt: ms(t.lastPlayedAt),
      inGameAt: t.steam?.inGame ? ms(t.steam.at) : null,
      hours2wk: measured,
      // Never shadows a measured figure, the same rule the board follows.
      estHours2wk: measured == null ? (e?.presenceHours?.d14 ?? null) : null,
      totalHours: s.totalHours ?? null,
      steamStatus: s.status ?? null,
    };
  });
}

const isPlaying = (p) =>
  p.lastPlayedAt != null && collectedAt != null &&
  Date.now() - collectedAt <= LIVE_MS && collectedAt - p.lastPlayedAt <= LIVE_MS;
const isInGame = (p) => p.inGameAt != null && Date.now() - p.inGameAt <= LIVE_MS;

// ---- the address bar -----------------------------------------------------------

function readUrl() {
  let sp;
  try { sp = new URLSearchParams(location.search); } catch { return []; }
  const raw = (sp.get("p") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 2);
  return raw.map((nm) => {
    const low = nm.toLowerCase();
    return (players.find((p) => p.name.toLowerCase() === low) ?? byId.get(nm))?.id ?? null;
  });
}

function writeUrl() {
  if (!window.history?.replaceState) return;
  const names = pair.map((id) => byId.get(id)?.name).filter(Boolean);
  const next = location.pathname + (names.length ? `?p=${names.map(encodeURIComponent).join(",")}` : "");
  if (next === location.pathname + location.search) return;
  try { window.history.replaceState(null, "", next); } catch {}
}

// ---- pickers -------------------------------------------------------------------

function fillSelect(sel, chosen) {
  const byTeam = new Map();
  for (const p of players) {
    const t = p.team ? teamName(p.team) : "Free agents";
    if (!byTeam.has(t)) byTeam.set(t, []);
    byTeam.get(t).push(p);
  }
  const teams = [...byTeam.keys()].sort((a, b) => a.localeCompare(b));
  sel.innerHTML = teams.map((t) =>
    `<optgroup label="${esc(t)}">` +
    byTeam.get(t).sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => `<option value="${esc(p.id)}"${p.id === chosen ? " selected" : ""}>${esc(p.name)}</option>`).join("") +
    `</optgroup>`).join("");
}

// ---- the comparison --------------------------------------------------------------

// One row: left value, label, right value. The higher figure is drawn
// brighter; there are no bars, just the numbers.
function row(label, a, b, { lowerLeads = false } = {}) {
  const va = a?.v ?? null, vb = b?.v ?? null;
  const lead = va != null && vb != null && va !== vb ? ((va > vb) !== lowerLeads ? "a" : "b") : null;
  const side = (x, cls) => {
    if (x?.text == null) return `<div class="v ${cls}"><span class="t"><span class="na">${esc(x?.na ?? "none")}</span></span></div>`;
    return `<div class="v ${cls}${lead === cls ? " lead" : ""}">` +
      `<span class="t"><span class="n">${x.text}</span>${x.sub ? `<span class="sub">${esc(x.sub)}</span>` : ""}</span></div>`;
  };
  return `<div class="r">${side(a, "a")}<div class="lb">${esc(label)}</div>${side(b, "b")}</div>`;
}

const rating = (p, pl) => {
  const v = p.mmr?.[pl];
  return v == null ? { na: "unranked" } : { v, text: nf(v), sub: p.tier?.[pl] ?? null };
};
// The account's career best from tracker.gg, with the season it was set in.
// A peak with no season is one we saw ourselves, newer than tracker.gg's.
const peak = (p, pl) => {
  const v = p.peak?.[pl];
  return v == null ? {} : { v, text: nf(v), sub: p.peak?.season?.[pl] ?? null };
};
// A window the tracker has not covered in full is not a low number; it is no
// number yet, and the board says "pending" for exactly this.
const windowGames = (p, w) => {
  const g = p.games?.total?.[w];
  if (!g || g.games == null) return {};
  if (g.partial) return { na: "pending" };
  return { v: g.games, text: nf(g.games) };
};
const seasonGames = (p, pl) => {
  const v = p.season?.[pl];
  return v == null ? {} : { v, text: nf(v) };
};
// Why a cell is empty, in the board's own words for the same Steam settings.
const STEAM_WHY = { private: "private", "hidden-details": "hidden", "playtime-hidden": "hours hidden", epic: "epic" };
const noHours = (p) => ({ na: STEAM_WHY[p.steamStatus] ?? "none" });
const hours = (p) => {
  if (p.hours2wk != null) return { v: p.hours2wk, text: `${nf(p.hours2wk)}<small>h</small>` };
  if (p.estHours2wk != null) return { v: p.estHours2wk, text: `${nf(p.estHours2wk)}<small>h</small>`, sub: "estimate" };
  return noHours(p);
};
const totalHours = (p) => (p.totalHours == null ? noHours(p) : { v: p.totalHours, text: `${nf(p.totalHours)}<small>h</small>` });
const lastGame = (p) => {
  if (isPlaying(p)) return { v: 0, text: "Playing" };
  const a = ago(p.lastPlayedAt);
  // Stored as minutes since, so "lower leads" means most recent.
  return a ? { v: (Date.now() - p.lastPlayedAt) / 60000, text: esc(a) } : {};
};

function card(p, cls) {
  const flag = p.country?.code ? flagSVG(p.country.code, p.country.name) : "";
  const place = p.country ? (flag || esc(p.country.label ?? p.country.code ?? "")) : "";
  const tw = p.twitch && /^[A-Za-z0-9_]{3,25}$/.test(p.twitch)
    ? `<a href="https://www.twitch.tv/${esc(p.twitch)}" target="_blank" rel="noopener noreferrer nofollow">twitch.tv/${esc(p.twitch)}</a>` : "";
  const state = isPlaying(p) ? `<span class="st on">Playing ranked</span>`
    : isInGame(p) ? `<span class="st on">In game</span>` : "";
  return `<div class="pc ${cls}">${crest(p.team, "xl")}<div class="id">` +
    `<span class="nm">${esc(p.name)}</span>` +
    `<span class="tm">${place}<span>${esc(p.team ? teamName(p.team) : "Free agent")}</span></span>` +
    (tw ? `<span class="tw">${tw}</span>` : "") +
    state + `</div></div>`;
}

function paint() {
  const [a, b] = pair.map((id) => byId.get(id));
  if (!a || !b) { $("out").innerHTML = ""; return; }
  const grp = (title, rows) => `<section class="grp"><h2>${esc(title)}</h2><div class="rows">${rows.join("")}</div></section>`;
  $("out").innerHTML =
    `<div class="who">${card(a, "a")}${card(b, "b")}</div>` +
    grp("Rating", PLAYLISTS.map(([k, lab]) => row(lab, rating(a, k), rating(b, k)))) +
grp("Peak rating", PLAYLISTS.map(([k, lab]) => row(lab, peak(a, k), peak(b, k)))) +
    grp("Ranked games", [
      row("Last 24h", windowGames(a, "d1"), windowGames(b, "d1")),
      row("Last 7 days", windowGames(a, "d7"), windowGames(b, "d7")),
      row("This season", seasonGames(a, "total"), seasonGames(b, "total")),
      ...PLAYLISTS.map(([k, lab]) => row(`Season ${lab}`, seasonGames(a, k), seasonGames(b, k))),
      row("Last game", lastGame(a), lastGame(b), { lowerLeads: true }),
    ]) +
    grp("Hours", [
      row("Last 2 weeks", hours(a), hours(b)),
      row("All time", totalHours(a), totalHours(b)),
    ]) +
    `<section class="grp"><h2>Rating over time</h2>` +
    `<div class="chartbar"><div class="plseg" id="plseg" role="group" aria-label="Playlist">` +
    PLAYLISTS.map(([k, lab]) => `<button type="button" data-pl="${k}" aria-pressed="${k === chartPl}">${lab}</button>`).join("") +
    `</div><div class="legend"><span><i style="background:var(--pa)"></i>${esc(a.name)}</span><span><i style="background:var(--pb)"></i>${esc(b.name)}</span></div></div>` +
    `<div class="chart" id="chart"></div></section>`;
  $("plseg").addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-pl]");
    if (!btn) return;
    chartPl = btn.dataset.pl;
    for (const x of $("plseg").querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === btn));
    paintChart();
  });
  paintChart();
}

// ---- rating chart ------------------------------------------------------------------

// Round steps a reader would pick for an axis.
function niceStep(span, target) {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
}

function paintChart() {
  const box = $("chart");
  if (!box) return;
  const W = 900, H = 300, L = 52, R = 14, T = 12, B = 30;
  if (!history) {
    // A failed fetch comes back as null, which is also "not here yet", so the
    // chart used to say it was loading for as long as the page stayed open.
    const words = historyFailed ? "The rating history did not load. Reload the page to try again." : "Loading rating history";
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${words}"><text class="empty" x="${W / 2}" y="${H / 2}" text-anchor="middle">${words}</text></svg>`;
    return;
  }
  const base = history.base;
  const series = pair.map((id) => (history.players?.[id]?.[chartPl] ?? []).map(([m, r]) => [base + m * 60000, r]));
  const now = collectedAt ?? Date.now();
  const pts = series.flat();
  if (!pts.length) {
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="No rating history"><text class="empty" x="${W / 2}" y="${H / 2}" text-anchor="middle">No ${esc(PLAYLISTS.find((x) => x[0] === chartPl)[1])} rating history for either player yet</text></svg>`;
    return;
  }
  const x0 = Math.min(...pts.map((p) => p[0]));
  const x1 = Math.max(now, ...pts.map((p) => p[0]));
  let y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
  if (y1 - y0 < 40) { const mid = (y0 + y1) / 2; y0 = mid - 20; y1 = mid + 20; }
  const step = niceStep(y1 - y0, 4);
  y0 = Math.floor(y0 / step) * step; y1 = Math.ceil(y1 / step) * step;
  const sx = (t) => L + ((t - x0) / Math.max(1, x1 - x0)) * (W - L - R);
  const sy = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);

  let g = "";
  for (let v = y0; v <= y1 + 1e-9; v += step) {
    g += `<line class="gl" x1="${L}" x2="${W - R}" y1="${sy(v).toFixed(1)}" y2="${sy(v).toFixed(1)}"/>` +
      `<text class="ax" x="${L - 8}" y="${(sy(v) + 3.5).toFixed(1)}" text-anchor="end">${nf(v)}</text>`;
  }
  // Date ticks: at most five, on whole days, and never two on the same day.
  const span = x1 - x0, day = 864e5;
  const dayStep = Math.max(1, Math.ceil(span / day / 5));
  const first = new Date(x0); first.setHours(0, 0, 0, 0);
  const ticks = [];
  for (let t = first.getTime() + day; t < x1; t += dayStep * day) ticks.push(t);
  const fmt = new Intl.DateTimeFormat("en-GB", span < 2 * day ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short" });
  const xt = span < 2 * day ? [x0, x0 + span / 2, x1] : ticks;
  for (const t of xt) g += `<text class="ax" x="${sx(t).toFixed(1)}" y="${H - 9}" text-anchor="middle">${fmt.format(new Date(t))}</text>`;

  // A rating only changes when a match ends, so the line is drawn as steps
  // and carried on to the latest collection rather than stopping at the last
  // change.
  const path = (s) => {
    if (!s.length) return "";
    let d = `M${sx(s[0][0]).toFixed(1)},${sy(s[0][1]).toFixed(1)}`;
    for (let i = 1; i < s.length; i++) d += `H${sx(s[i][0]).toFixed(1)}V${sy(s[i][1]).toFixed(1)}`;
    return d + `H${sx(x1).toFixed(1)}`;
  };
  const end = (s, cls) => (s.length ? `<circle class="${cls}" cx="${sx(x1).toFixed(1)}" cy="${sy(s[s.length - 1][1]).toFixed(1)}" r="3.5"/>` : "");
  const names = pair.map((id) => byId.get(id)?.name ?? "");
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${names[0]} and ${names[1]}, ${PLAYLISTS.find((x) => x[0] === chartPl)[1]} rating over time`)}">` +
    g + `<path class="la" d="${path(series[0])}"/><path class="lb2" d="${path(series[1])}"/>` +
    end(series[0], "ea") + end(series[1], "eb") + `</svg>`;
}

// ---- start -------------------------------------------------------------------------

function choose(i, id) {
  pair[i] = id;
  writeUrl();
  paint();
}

async function start() {
  $("yr").textContent = String(new Date().getFullYear());
  const board = await getJson("board.json");
  players = buildPlayers(board);
  if (!players.length) {
    $("msg").hidden = false;
    $("msg").textContent = "The player data did not load. Reload the page to try again.";
    return;
  }
  byId = new Map(players.map((p) => [p.id, p]));
  assignHues(players.map((p) => p.team));

  // Default: the top two by 2v2 rating, which is how the board ranks.
  const ranked = [...players].sort((x, y) => (y.mmr.twos ?? -1) - (x.mmr.twos ?? -1));
  const want = readUrl();
  pair = [want[0] ?? ranked[0].id, want[1] ?? ranked.find((p) => p.id !== (want[0] ?? ranked[0].id)).id];
  if (pair[0] === pair[1]) pair[1] = ranked.find((p) => p.id !== pair[0]).id;

  fillSelect($("selA"), pair[0]);
  fillSelect($("selB"), pair[1]);
  $("selA").addEventListener("change", (e) => choose(0, e.target.value));
  $("selB").addEventListener("change", (e) => choose(1, e.target.value));
  $("swap").addEventListener("click", () => {
    pair.reverse();
    $("selA").value = pair[0];
    $("selB").value = pair[1];
    writeUrl();
    paint();
  });
  writeUrl();
  paint();

  history = await getJson("mmr-history.json");
  historyFailed = !history;
  paintChart();
}

start();

// Alpha Boost: the Psyonix developers, most recently playing first.
//
// Two feeds: data/derived/alpha.json, written by the tracker collector, and
// data/derived/devs-steam.json, Steam's in-game answer, written every minute.
// A developer counts as playing when a game of theirs, in any playlist, was
// logged in the last ACTIVE_MS, either by tracker.gg or by their Casual rating
// moving between two checks; beating one in any mode unlocks the boost. The
// Playing mark names the mode of that game.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = (n) => (n == null ? null : Math.round(n).toLocaleString("en-GB"));

const ACTIVE_MS = 20 * 60e3;
const INGAME_MS = 10 * 60e3; // the board's LIVE_MS
const REFRESH_MS = 60e3;
// tracker.gg's playlist names, shortened for a badge.
const SHORT = { "Ranked Duel 1v1": "Ranked 1v1", "Ranked Doubles 2v2": "Ranked 2v2", "Ranked Standard 3v3": "Ranked 3v3", "Ranked 4v4 Quads": "Ranked 4v4" };
const short = (m) => SHORT[m] ?? m;
const PLATFORM = { steam: "Steam", epic: "Epic", psn: "PlayStation", xbl: "Xbox", switch: "Switch" };

const ms = (iso) => {
  const v = iso ? Date.parse(iso) : NaN;
  return isNaN(v) ? null : v;
};
const ago = (t) => {
  if (t == null) return null;
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
};

const getJson = (f) =>
  fetch(`/data/${f}?v=${Math.floor(Date.now() / 60000)}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

// The board's two marks, with the same meanings. Playing: a game in the
// last ACTIVE_MS. In game: Steam says Rocket League is open, which
// covers menus and queueing too and only exists for Steam developers with a
// public profile. Playing wins where both hold.
const playing = (d) => {
  const c = ms(d.seenAt);
  return c != null && Date.now() - c < ACTIVE_MS;
};
const inGame = (d) => {
  const g = ms(d.inGameAt);
  return g != null && Date.now() - g < INGAME_MS;
};

// The rating for what they are playing: while Playing in a playlist with a
// rating, that one, labelled; otherwise Casual, which is where most of them
// are found.
function mmrCell(d, on) {
  const inMode = on && d.mode && d.mode !== "Casual" ? d.ratings?.[d.mode] : null;
  const v = inMode ?? d.rating;
  if (v == null) return '<span class="na">-</span>';
  const label = inMode != null ? short(d.mode) : "Casual";
  return `<span class="mmr">${nf(v)}</span><span class="mmrl">${esc(label)}</span>`;
}

function row(d) {
  // Until tracker.gg has given a last game, the last time Steam saw the game
  // open stands in for it.
  const game = ms(d.seenAt);
  const seen = game ?? ms(d.inGameAt);
  const on = playing(d);
  const mark = on
    ? `<span class="pmark" title="Played in the past 20 minutes">Playing${d.mode ? " " + esc(short(d.mode)) : ""}</span>`
    : inGame(d) ? '<span class="gmark" title="Steam says Rocket League is open">In game</span>' : "";
  const last = seen != null ? ago(seen) : d.readAt ? "None recorded" : "Not read yet";
  return `<tr${on ? ' class="on"' : ""}>
    <td><div class="who"><a class="nm" href="${esc(d.url)}" target="_blank" rel="noopener" title="tracker.gg profile">${esc(d.name)}</a>${mark}</div><span class="pf">${esc(PLATFORM[d.platform] ?? d.platform)}</span></td>
    <td><span class="last${seen == null ? " na" : ""}"${game == null && seen != null ? ' title="Last seen with Rocket League open on Steam"' : ""}>${esc(last)}</span></td>
    <td class="num">${mmrCell(d, on)}</td>
  </tr>`;
}

function render(feed) {
  const msg = $("msg");
  const devs = feed?.devs ?? [];
  if (!devs.length) {
    msg.textContent = feed ? "No developers listed." : "The developer feed did not load. It retries every minute.";
    msg.hidden = false;
    $("out").innerHTML = "";
    return;
  }
  msg.hidden = true;
  // Playing, then In game, then by the last game.
  const tier = (d) => (playing(d) ? 0 : inGame(d) ? 1 : 2);
  const key = (d) => ms(d.seenAt) ?? ms(d.inGameAt) ?? -Infinity;
  const list = [...devs].sort((a, b) => tier(a) - tier(b) || key(b) - key(a) || String(a.name).localeCompare(String(b.name)));

  $("out").innerHTML = `
    <div class="wrap"><table>
      <thead><tr><th scope="col">Developer</th><th scope="col">Last game</th><th scope="col" class="num">MMR</th></tr></thead>
      <tbody>${list.map(row).join("")}</tbody>
    </table></div>`;
}

// Steam's answer is joined on by key. Either file failing leaves the other
// standing: no Steam file just means no In game marks.
let last = null;
let steam = {};
async function load() {
  const [feed, st] = await Promise.all([getJson("alpha.json"), getJson("devs-steam.json")]);
  if (st?.devs) steam = st.devs;
  const base = feed ?? last;
  if (feed) last = feed;
  if (base || !last) render(base && { ...base, devs: base.devs.map((d) => ({ ...d, ...(steam[d.key] ?? {}) })) });
}

$("yr").textContent = new Date().getFullYear();
load();
setInterval(() => (document.hidden ? null : load()), REFRESH_MS);
// Times on the page are relative, so repaint them between fetches too.
setInterval(() => (last && !document.hidden ? render({ ...last, devs: last.devs.map((d) => ({ ...d, ...(steam[d.key] ?? {}) })) }) : null), 30e3);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });

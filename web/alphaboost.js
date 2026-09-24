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

// A Steam icon beside the name, for public Steam profiles only: the Steam
// check leaves the id out for private ones.
// The Steam logo, from Simple Icons (CC0).
const STEAM_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z"/></svg>';
const steamLink = (d) => (/^\d{17}$/.test(d.steamId ?? "")
  ? `<a class="steam" href="https://steamcommunity.com/profiles/${d.steamId}" target="_blank" rel="noopener" title="Steam profile" aria-label="${esc(d.name)} on Steam">${STEAM_ICON}</a>`
  : "");

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
    <td><div class="who"><a class="nm" href="${esc(d.url)}" target="_blank" rel="noopener" title="tracker.gg profile">${esc(d.name)}</a>${steamLink(d)}${mark}</div><span class="pf">${esc(PLATFORM[d.platform] ?? d.platform)}</span></td>
    <td><span class="last${seen == null ? " na" : ""}"${game == null && seen != null ? ' title="Last seen with Rocket League open on Steam"' : ""}>${esc(last)}</span></td>
    <td class="sp">${(d.spotted ?? []).length ? d.spotted.map((x) => `<span class="chip">${esc(x)}</span>`).join("") : '<span class="na">-</span>'}</td>
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
      <thead><tr><th scope="col">Developer</th><th scope="col">Last game</th><th scope="col">Spotted in</th><th scope="col" class="num">MMR</th></tr></thead>
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

// ---- Report bar ------------------------------------------------------------
// The same relay as the board's feedback form; reports go to a private
// Discord channel, not a GitHub issue.
// The floor and ceiling are that relay's (functions/feedback.js), checked
// here first so a short report fails with a reason rather than a 400.
const RP_MIN = 25, RP_MAX = 500;
const rp = $("rpForm");
if (rp) {
  const res = $("rpRes"), btn = $("rpBtn"), msgEl = $("rpMsg");
  const say = (text, err) => { res.textContent = text; res.className = "rp-res" + (err ? " err" : ""); };
  rp.addEventListener("submit", (e) => {
    e.preventDefault();
    const user = ($("rpUser").value || "").trim().slice(0, 60);
    const message = (msgEl.value || "").trim().slice(0, RP_MAX);
    if (message.length < RP_MIN) {
      say(message ? `A little more detail please: ${RP_MIN - message.length} more character${RP_MIN - message.length === 1 ? "" : "s"}.` : "Add what you are reporting first.", true);
      msgEl.focus();
      return;
    }
    btn.disabled = true;
    say("Sending…");
    fetch("/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user, type: "Alpha Boost report", message, hp: $("rpHp").value }),
    })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(() => { say("Sent. Thanks!"); rp.reset(); })
      .catch((err) => say(err.message === "429" ? "One report a minute, please. Try again shortly." : "Could not send it. Try again in a minute.", true))
      .finally(() => { btn.disabled = false; });
  });
}

$("yr").textContent = new Date().getFullYear();
load();
setInterval(() => (document.hidden ? null : load()), REFRESH_MS);
// Times on the page are relative, so repaint them between fetches too.
setInterval(() => (last && !document.hidden ? render({ ...last, devs: last.devs.map((d) => ({ ...d, ...(steam[d.key] ?? {}) })) }) : null), 30e3);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });

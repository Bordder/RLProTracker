// Psyonix developers, for the Alpha Boost page.
//
// Beating a developer in any mode unlocks the Alpha Boost, and most of them
// play Casual, so the useful things to know about each one are whether they
// are playing right now and their Casual rating (which decides who the
// matchmaker pairs them with).
//
// The tracker collector reads a few developers each run (see pickDevs), through
// the same cleared browser contexts it uses for the roster. This file holds the pure
// parts: turning tracker links into profile ids, pulling the Casual figures out
// of a profile, and folding a reading into the running state. All unit-tested.

// tracker.gg keys profiles by platform. Its links use the same slugs as the API
// except PlayStation, which the site calls "psn" in both places.
const PLATFORMS = new Set(["steam", "epic", "psn", "xbl", "switch"]);

// A tracker.gg profile link, or a bare "platform/id", as {platform, id}.
// Returns null for anything else, so a pasted link that is not a profile is
// caught at load time instead of being queried as a player.
export function parseProfile(link) {
  const s = String(link ?? "").trim();
  const m = s.match(/profile\/([a-z]+)\/([^/?#]+)/i) || s.match(/^([a-z]+)\/([^/?#]+)$/i);
  if (!m) return null;
  const platform = m[1].toLowerCase();
  if (!PLATFORMS.has(platform)) return null;
  let id;
  try { id = decodeURIComponent(m[2]); } catch { id = m[2]; }
  return id ? { platform, id } : null;
}

export const profileUrl = ({ platform, id }) =>
  `https://rocketleague.tracker.network/rocket-league/profile/${platform}/${encodeURIComponent(id)}/overview`;

export const apiUrl = ({ platform, id }) =>
  `https://api.tracker.gg/api/v2/rocket-league/standard/profile/${platform}/${encodeURIComponent(id)}`;

// Casual rating and the display name. tracker.gg's Casual games-played stays
// at 0 for everyone, so it is not read.
export function pickCasual(json) {
  const segs = json?.data?.segments;
  if (!Array.isArray(segs)) return null;
  const lists = segs.filter((s) => s.type === "playlist");
  const casual = lists.find((s) => s.metadata?.name === "Casual");
  const num = (v) => (Number.isFinite(v) ? v : null);
  const handle = json?.data?.platformInfo?.platformUserHandle;
  // A Steam link can be a vanity name; the profile carries the 64-bit id the
  // Steam presence check needs.
  const uid = String(json?.data?.platformInfo?.platformUserId ?? "");
  return {
    handle: typeof handle === "string" && handle.trim() ? handle.trim() : null,
    steamId: /^\d{17}$/.test(uid) ? uid : null,
    rating: num(casual?.stats?.rating?.value),
  };
}

// When a developer last played, from their recent matches on tracker.gg.
//
// tracker.gg cannot see Casual game counts, so it logs a Casual game from the
// account's win count going up with no ranked playlist moving, and files it
// under the playlist name "Multiple" (checked 24 September 2026: Red has 36
// of those between 20:24 and 03:11 UTC the night before, and not one entry
// called "Casual" after the season began). Those, and anything actually
// called Casual, are unranked games; the ranked playlists are other games.
//
// A season reset writes one entry per playlist, all with the same timestamp;
// that is a refresh, not a game, and would otherwise read as everyone having
// played everything at once. Any timestamp shared by three or more entries is
// skipped.
//
// mode is the playlist of the newest game, with "Multiple" read as Casual.
// tracker.gg cannot tell Casual 2v2, 3v3 and 4v4 apart, so Casual is as
// precise as it gets.
export const modeName = (pl) => (pl === "Multiple" ? "Casual" : pl || null);

export function lastGames(json) {
  const all = [];
  for (const item of json?.data?.items ?? []) {
    for (const m of item?.matches ?? []) {
      const t = Date.parse(m?.metadata?.dateCollected);
      if (Number.isFinite(t)) all.push({ t, pl: String(m.metadata.playlist ?? "") });
    }
  }
  const stamp = new Map();
  for (const m of all) stamp.set(m.t, (stamp.get(m.t) ?? 0) + 1);
  let unranked = null, any = null, mode = null;
  for (const m of all) {
    if (stamp.get(m.t) >= 3) continue;
    if (any == null || m.t > any) { any = m.t; mode = modeName(m.pl); }
    if ((m.pl === "Multiple" || m.pl === "Casual") && (unranked == null || m.t > unranked)) unranked = m.t;
  }
  const iso = (t) => (t == null ? null : new Date(t).toISOString());
  return { casualAt: iso(unranked), seenAt: iso(any), mode };
}

// Fold one reading into a developer's state.
//
// Two signals, and the later of the two wins. The recent matches (lastGames)
// are what tracker.gg itself logged. The Casual rating also moves after every
// Casual game, so a move between two of our readings is a game seen at this
// reading's time, which catches one before tracker.gg's own log has it.
export function nextDevState(prev, reading, at, games = null) {
  const p = prev ?? {};
  const later = (...xs) => xs.filter(Boolean).sort().at(-1) ?? null;
  const moved = p.rating != null && reading.rating != null && reading.rating !== p.rating;
  const casualAt = later(p.casualAt, games?.casualAt, moved ? at : null);
  const seenAt = later(p.seenAt, games?.seenAt, casualAt);
  // The mode goes with whichever signal set seenAt: tracker.gg's own log
  // names it, a Casual rating move means Casual.
  const mode = seenAt && seenAt === games?.seenAt ? games.mode
    : seenAt && seenAt !== p.seenAt && seenAt === casualAt ? "Casual"
    : p.mode ?? null;
  return {
    readAt: at,
    handle: reading.handle ?? p.handle ?? null,
    steamId: reading.steamId ?? p.steamId ?? null,
    rating: reading.rating ?? p.rating ?? null,
    casualAt,
    seenAt,
    mode,
  };
}

// The Steam id each Steam developer's presence is read by: the link's own id
// when it is numeric, otherwise the one their profile reported.
export function steamIdOf(d, state) {
  if (d.platform !== "steam") return null;
  return /^\d{17}$/.test(d.id) ? d.id : state[d.key]?.steamId ?? null;
}

// Steam's presence answer for the Steam developers, as the page's second
// feed (data/derived/devs-steam.json). The same rule as the board's In game
// mark (presenceHot.classifyPresence): a public profile running Rocket League
// is in game, a private one cannot be told. inGameAt carries over from the
// previous file, so a developer who has left still shows when they were last
// in game. Written by its own every-minute job (scripts/devsSteam.mjs), apart
// from the tracker's state, so the two jobs never overwrite each other.
export function steamFeed(devs, state, summaries, prev, at, appId = "252950") {
  const bySteam = new Map((summaries ?? []).map((x) => [x.steamid, x]));
  const out = {};
  for (const d of devs) {
    const id = steamIdOf(d, state);
    if (!id) continue;
    const x = bySteam.get(id);
    const steam = !x || x.communityvisibilitystate !== 3 ? "private" : String(x.gameid) === appId ? "in" : "out";
    out[d.key] = { steam, inGameAt: steam === "in" ? at : prev?.devs?.[d.key]?.inGameAt ?? null };
  }
  return { devs: out };
}

// What the page reads: one row per developer, with the link back to their
// profile. Developers never read yet still appear, with nulls, so a bad link
// shows up as an empty row rather than a missing one.
export function alphaFeed(devs, state, at) {
  return {
    updatedAt: at,
    devs: devs.map((d) => {
      const s = state[d.key] ?? {};
      return {
        key: d.key,
        name: d.name ?? s.handle ?? d.id,
        platform: d.platform,
        url: profileUrl(d),
        rating: s.rating ?? null,
        casualAt: s.casualAt ?? null,
        seenAt: s.seenAt ?? null,
        mode: s.mode ?? null,
        readAt: s.readAt ?? null,
      };
    }),
  };
}

// Which developers one run reads. All twenty-five every run would triple the
// collector's requests, so a run takes a batch: anyone never read, then
// anyone live (Steam says the game is open, or a game in the last half hour),
// who are read every run while there is room, then whoever was read longest
// ago. That keeps a live developer's row current and still walks the whole
// list every few runs.
export function pickDevs(devs, state, now, limit, steam = {}) {
  const t = (iso) => (iso ? Date.parse(iso) || 0 : 0);
  const rank = (d) => {
    const s = state[d.key];
    if (!s?.readAt) return [0, 0];
    if (steam[d.key]?.steam === "in" || now - t(s.seenAt) < 30 * 60e3) return [1, t(s.readAt)];
    return [2, t(s.readAt)];
  };
  return devs
    .map((d) => ({ d, r: rank(d) }))
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1])
    .slice(0, limit)
    .map((x) => x.d);
}

// data/devs.json as a list of {key, name, platform, id}. Entries whose link
// does not parse are dropped with a warning rather than failing the run: the
// roster's collection must never stop over this page.
export function loadDevs(file) {
  const out = [];
  const seen = new Set();
  for (const d of file?.devs ?? []) {
    const who = parseProfile(d.tracker);
    if (!who) { console.log(`devs: skipping ${d.name ?? "(unnamed)"}, not a tracker.gg profile link: ${d.tracker}`); continue; }
    const key = `${who.platform}/${who.id.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, name: d.name || null, ...who });
  }
  return out;
}

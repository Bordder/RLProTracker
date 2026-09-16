// Read a player's nationality and Twitch channel out of their Liquipedia page.
//
// Both come off a wiki, so both are attacker-controlled: anyone with an account
// can edit a player page. Neither value is sanitized here, because neither is
// passed through. The country name is looked up in a fixed table and an unknown
// name becomes null, and a Twitch channel must match Twitch's own character set
// exactly or it is discarded. Nothing that is not already on an allowlist can
// reach the board, which is a stronger property than escaping.

import { codeOf, countryOf } from "./countries.mjs";

// Path segments that are Twitch's own pages rather than a channel. A link to
// twitch.tv/directory is not somebody's stream.
const RESERVED = new Set([
  "directory", "videos", "settings", "downloads", "jobs", "turbo", "store",
  "p", "popout", "team", "products", "subs", "friends", "following",
  "wallet", "prime", "user", "search", "legal", "privacy", "broadcast",
]);

// Twitch's own rule for a login: letters, digits and underscore, 3-25 chars.
const CHANNEL = /^[A-Za-z0-9_]{3,25}$/;

// The channel, or null. A clip is not a channel: the roster's own data had
// twitch.tv/vatira_/clip/... and clips.twitch.tv/... sitting beside the real
// link, and taking the first match would have published either.
export function twitchFromLinks(links) {
  for (const l of links ?? []) {
    const raw = typeof l === "string" ? l : l?.url;
    if (!raw) continue;
    let u;
    try { u = new URL(raw); } catch { continue; }
    if (u.protocol !== "https:" && u.protocol !== "http:") continue;
    // clips.twitch.tv and m.twitch.tv are not the channel host.
    if (u.hostname !== "twitch.tv" && u.hostname !== "www.twitch.tv") continue;
    const parts = u.pathname.split("/").filter(Boolean);
    // Exactly one segment. Anything deeper is a clip, a video or a subpage.
    if (parts.length !== 1) continue;
    const name = parts[0];
    if (!CHANNEL.test(name) || RESERVED.has(name.toLowerCase())) continue;
    return name;
  }
  return null;
}

// `|country=` from the page's infobox, as written. Only top-level template
// parameters count, so a country named inside some other template on the page
// is not mistaken for the player's own.
//
// Liquipedia writes a UK player as country=England with country2=United
// Kingdom, so `country` is the specific one and taking the first is right.
export function countryFromWikitext(text) {
  if (!text) return { country: null, country2: null };
  const read = (field) => {
    const m = new RegExp(`^\\s*\\|\\s*${field}\\s*=\\s*([^|{}\\n]+?)\\s*$`, "im").exec(String(text));
    return m ? m[1] : null;
  };
  return { country: read("country"), country2: read("country2") };
}

// England, Scotland, Wales and Northern Ireland are always written with the
// United Kingdom as the second country. That is one nationality spelled out in
// two fields, not two nationalities: "England and the United Kingdom" says
// nothing the first half did not. It is dropped, and a genuine second
// nationality - Mexico beside the United States - is kept.
const PARENT_OF = { gbeng: "GB", gbsct: "GB", gbwls: "GB", gbnir: "GB" };

// Is this page about a player at all?
//
// Liquipedia hands the bare title to whoever held it first, so "Juicy" is a
// Dutch caster while the Karmine Corp player lives at "Juicy (French Player)".
// Nothing about reading the wrong page fails: it returns a real infobox with a
// real nationality and a real Twitch channel, all belonging to somebody else.
// Two independent signals, because either alone has false negatives - a page
// can be miscategorised, and a player who also casts carries a Caster role.
export function looksWrongPerson(page) {
  const text = page?.revisions?.[0]?.slots?.main?.content ?? "";
  const cats = (page?.categories ?? []).map((c) => String(c.title || ""));
  if (!cats.length) return null;                                   // nothing to judge on
  const isPlayer = cats.some((c) => /(^|:)(.*\s)?Players$/i.test(c));
  if (isPlayer) return null;
  const role = /^\s*\|\s*roles?\s*=\s*(.+?)\s*$/im.exec(text)?.[1]
    ?? /\|\s*roles?\s*=\s*([A-Za-z ]+)/i.exec(text)?.[1]
    ?? null;
  return { role: role ? role.trim() : null, categories: cats.map((c) => c.replace(/^Category:/, "")) };
}

// What gets stored on a roster entry. `country` is the nationality Liquipedia
// lists first and `country2` the second where there is a real one.
export function profileFrom(page) {
  const text = page?.revisions?.[0]?.slots?.main?.content ?? null;
  const { country, country2 } = countryFromWikitext(text);
  const primary = countryOf(country);
  let second = countryOf(country2);
  if (primary && second && PARENT_OF[primary.code] === second.code) second = null;
  return {
    country: primary,
    country2: second,
    // Names the table does not know yet, so the fetch can say so out loud
    // instead of silently dropping a player's flag.
    unmapped: [country, country2].filter((n) => n && !codeOf(n)),
    twitch: twitchFromLinks(page?.extlinks),
  };
}

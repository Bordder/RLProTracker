// Team marks, matching the board.
//
// Ported from web/rlpt.js rather than reinvented, so a team looks the same on
// both pages. Same slug rule, same initials overrides, same hue spread, same
// "monogram underneath, logo on top" trick - if a logo file is missing or
// fails to load, the tinted monogram is already there behind it.
//
// The one difference is scale: the board draws 32px circles in a table, this
// draws 18px squares inside a bracket row where vertical space is the scarce
// thing.

export const LOGO_DIR = "/img/teams/";

// Drop a file at img/teams/<slug>.<ext> and list its extension here.
const TEAM_LOGO = {
  "geng-mobil1-racing": "png", "karmine-corp": "png", "lil-step-bros": "png",
  "mibr": "png", "nrg": "png", "shopify-rebellion": "png",
  "spacestation-gaming": "png", "team-bsk": "png", "tsm": "png", "wildcard": "svg",
  "complexity-gaming": "png", "gentle-mates": "png", "team-falcons": "png",
  "team-vitality": "png", "furia": "png", "twisted-minds": "png", "team-secret": "png",
  "g2-stride": "png", "gaimin-gladiators": "png", "ninjas-in-pyjamas": "png",
  "geekay-esports": "png", "fut-esports": "png", "r8-esports": "png",
  "dignitas": "png", "quiktrip-pioneers-gaming": "png", "pwr": "png",
  "virtuspro": "png", "five-fears": "png", "oxygen-esports": "png",
  "team-bds": "png", "manchester-city-esports": "png", "og": "png",
  "luminosity-gaming": "png", "the-ultimates": "png", "roc-esports": "png",
  "rule-one": "png", "elevate": "png", "chiefs-esports-club": "png",
  "limitless": "png",
};

// One org, several names over the years. The display name stays whatever the
// event called it at the time - "FURIA Esports" really was the 2024 name - but
// they all share one logo file rather than one copy per spelling.
const LOGO_ALIAS = {
  "furia-esports": "furia",
  "gentle-mates-alpine": "gentle-mates",
  "geng": "geng-mobil1-racing",
  "geng-esports": "geng-mobil1-racing",
  "helfie-chiefs": "chiefs-esports-club",
};

// Initials people actually use, where the first two letters are not it.
const TEAM_INITIALS = {
  "gentle-mates": "M8", "team-vitality": "VIT", "ninjas-in-pyjamas": "NIP",
  "dignitas": "DIG", "m80": "M80", "fut-esports": "FUT", "geekay-esports": "GK",
  "ght": "GHT", "r8-esports": "R8", "wildcard": "WC", "tsm": "TSM",
  "team-falcons": "FAL", "canterbury-bankstown-bulldogs": "CBB",
  "pwr": "PWR", "take-flyte": "TF",
  // The teams with no logo file, so their placeholder reads as a mark rather
  // than the first two letters of a two-word name ("Mate y Tapa" -> "MY").
  "mate-y-tapa": "MYT", "bigodes": "BGD", "rstv": "RSTV", "limitless": "LMT",
  "team-mobula": "MOB",
};

export const teamSlug = (name) =>
  String(name || "").toLowerCase()
    .replace(/[’'".]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const initials = (name) => {
  const words = String(name || "").split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
};

// Hues are spread evenly across the field rather than hashed: with 20 orgs a
// hash puts several within a few degrees of each other and they read as the
// same colour.
const HUE = new Map();
export function assignHues(names) {
  const uniq = [...new Set(names.filter(Boolean))].sort();
  HUE.clear();
  uniq.forEach((n, i) => HUE.set(n, Math.round((i * 360) / uniq.length)));
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** The mark for one team. `size` is a CSS length. */
export function crest(name, cls = "") {
  if (!name) return `<span class="av tbdav ${cls}" aria-hidden="true">?</span>`;
  const h = HUE.get(name) ?? 0;
  const style = `--mk:hsl(${h} 42% 17%);--mkfg:hsl(${h} 70% 62%);--mkline:hsl(${h} 45% 34%)`;
  const raw = teamSlug(name);
  const slug = LOGO_ALIAS[raw] ?? raw;
  const ext = TEAM_LOGO[slug];
  const mono = TEAM_INITIALS[raw] || TEAM_INITIALS[slug] || initials(name);
  const size = mono.length > 3 ? " mk4" : mono.length > 2 ? " mk3" : "";
  // The monogram is always rendered; a logo, when there is one, covers it.
  return `<span class="av ${cls}${ext ? " haslogo" : " nologo"}${size}" style="${style}" aria-hidden="true">${esc(mono)}` +
    (ext ? `<img src="${esc(LOGO_DIR + slug + "." + ext)}" alt="" loading="lazy" decoding="async">` : "") +
    `</span>`;
}

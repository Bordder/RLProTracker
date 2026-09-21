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
  "geng-mobil1-racing": "webp", "karmine-corp": "webp", "lil-step-bros": "webp",
  "mibr": "webp", "nrg": "webp", "shopify-rebellion": "webp",
  "spacestation-gaming": "webp", "team-bsk": "webp", "tsm": "webp", "wildcard": "svg",
  "complexity-gaming": "webp", "gentle-mates": "webp", "team-falcons": "webp",
  "team-vitality": "webp", "furia": "webp", "twisted-minds": "webp", "team-secret": "webp",
  "g2-stride": "webp", "gaimin-gladiators": "webp", "ninjas-in-pyjamas": "webp",
  "geekay-esports": "webp", "fut-esports": "webp", "r8-esports": "webp",
  "dignitas": "webp", "pioneers": "webp", "pwr": "webp",
  "virtuspro": "webp", "five-fears": "webp", "oxygen-esports": "webp",
  "team-bds": "webp", "man-city-esports": "webp", "og": "webp",
  "luminosity-gaming": "webp", "the-ultimates": "webp", "roc-esports": "webp",
  "rule-one": "webp", "elevate": "webp", "chiefs-esports-club": "webp",
  "limitless": "webp",
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
  // Liquipedia's full names against the roster's shorter ones. The files are
  // named the way the roster spells them, because that is what the board draws
  // most of.
  "manchester-city-esports": "man-city-esports",
  // And the reverse. The live bracket feed carries BOTH "Team Vitality" and
  // "Vitality" as separate team names, because Liquipedia spells the org
  // differently between events, so the short one missed the file entirely and
  // drew a "VI" monogram beside the full name's crest.
  "vitality": "team-vitality",
  "quiktrip-pioneers-gaming": "pioneers",
  "virtus-pro": "virtuspro",
  // The side disciplines enter under the short code an org is known by, and
  // those pages are not run through the team alias map (it is built for the
  // 3v3 field, where a short code is an unresolved name rather than a choice).
  // So the codes that really are an org belong here.
  "ssg": "spacestation-gaming",
  "kc": "karmine-corp",
  "nrg": "nrg",
  "tm": "twisted-minds",
};

// The org a short code stands for, for display.
//
// The side disciplines enter under the code the org is known by - the 2026 2v2
// field has "ssg" in it, lowercase, exactly as Liquipedia writes the entry -
// and those pages deliberately skip the 3v3 team alias map. A code is not a
// name, so the code is resolved here and the full name is what gets drawn.
const TEAM_NAME = {
  "ssg": "Spacestation Gaming",
  "kc": "Karmine Corp",
  "tm": "Twisted Minds",
  "nrg": "NRG",
  "vp": "Virtus.pro",
  "flcn": "Team Falcons",
  "m8": "Gentle Mates",
  "g2": "G2 Stride",
  "bds": "Team BDS",
  "sr": "Shopify Rebellion",
};

/**
 * The name to draw for an entry.
 *
 * Only a known short code is expanded. Anything else is returned exactly as
 * the source wrote it, because a name this map has never heard of is a real
 * name and guessing at it would invent an org.
 */
export const teamName = (name) => {
  if (!name) return name;
  return TEAM_NAME[teamSlug(name)] ?? name;
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

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * Is there a logo file for this name?
 *
 * For the side disciplines: a 1v1 opponent is a person and a 2v2 duo is a name
 * two players made up, so neither gets a tinted monogram standing in for an
 * org that does not exist. But "Team Falcons" entering the 2v2 IS Team
 * Falcons, and their crest belongs on that row.
 */
export const hasLogo = (name) => {
  const raw = teamSlug(name);
  return Boolean(TEAM_LOGO[LOGO_ALIAS[raw] ?? raw]);
};

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

// Country name -> ISO 3166-1 alpha-2, and a flag from the code.
//
// The names come from Liquipedia's `|country=` infobox field, which is written
// by hand by wiki editors, so this maps NAMES rather than deriving anything. An
// unmapped name returns null and the board simply shows no flag: a wrong flag
// on a player is worse than no flag, and a missing one is visible in the fetch
// log so it gets added here.
//
// A flag emoji is two regional indicator letters, which is why no image files
// are involved. Windows ships no flag glyphs in Segoe UI Emoji, so there the
// pair falls back to two letterboxes reading "FR" - legible, and the reason the
// ISO code is also published rather than only the emoji.

// Liquipedia writes the UK's nations separately and tags the player with the UK
// as a second country. These are not ISO country codes; they are the subdivision
// codes the corresponding emoji tag sequences are built from.
const SUBDIVISION = {
  England: "gbeng",
  Scotland: "gbsct",
  Wales: "gbwls",
  "Northern Ireland": "gbnir",
};

const CODE = {
  Argentina: "AR", Australia: "AU", Austria: "AT", Bahrain: "BH", Belgium: "BE",
  Bolivia: "BO", Brazil: "BR", Bulgaria: "BG", Canada: "CA", Chile: "CL",
  China: "CN", Colombia: "CO", "Costa Rica": "CR", Croatia: "HR", Cuba: "CU",
  Cyprus: "CY", "Czech Republic": "CZ", Czechia: "CZ", Denmark: "DK",
  "Dominican Republic": "DO", Ecuador: "EC", Egypt: "EG", Estonia: "EE",
  Finland: "FI", France: "FR", Germany: "DE", Greece: "GR", "Hong Kong": "HK",
  Hungary: "HU", Iceland: "IS", India: "IN", Indonesia: "ID", Iran: "IR",
  Iraq: "IQ", Ireland: "IE", Israel: "IL", Italy: "IT", Jamaica: "JM",
  Japan: "JP", Jordan: "JO", Kazakhstan: "KZ", Kenya: "KE", Kuwait: "KW",
  Latvia: "LV", Lebanon: "LB", Lithuania: "LT", Luxembourg: "LU",
  Malaysia: "MY", Malta: "MT", Mexico: "MX", Morocco: "MA", Netherlands: "NL",
  "New Zealand": "NZ", Nigeria: "NG", Norway: "NO", Oman: "OM", Pakistan: "PK",
  Panama: "PA", Paraguay: "PY", Peru: "PE", Philippines: "PH", Poland: "PL",
  Portugal: "PT", "Puerto Rico": "PR", Qatar: "QA", Romania: "RO",
  Russia: "RU", "Saudi Arabia": "SA", Serbia: "RS", Singapore: "SG",
  Slovakia: "SK", Slovenia: "SI", "South Africa": "ZA", "South Korea": "KR",
  Spain: "ES", Sweden: "SE", Switzerland: "CH", Taiwan: "TW", Thailand: "TH",
  Tunisia: "TN", Turkey: "TR", Ukraine: "UA",
  "United Arab Emirates": "AE", "United Kingdom": "GB", "United States": "US",
  Uruguay: "UY", Venezuela: "VE", Vietnam: "VN",
};

// Region codes the flag rule is built from, so the board can render a flag for
// England without a special case downstream.
const SUBDIVISION_LABEL = { gbeng: "ENG", gbsct: "SCO", gbwls: "WAL", gbnir: "NIR" };

const A = 0x1f1e6 - "A".charCodeAt(0);   // 'A' -> REGIONAL INDICATOR SYMBOL LETTER A
const TAG = 0xe0000;                      // ASCII -> TAG character
const BLACK_FLAG = 0x1f3f4;
const CANCEL_TAG = 0xe007f;

// A pair of regional indicators, which a platform with flag glyphs draws as one
// flag and every other platform draws as the country's own two letters.
export function flagOf(code) {
  if (!code) return null;
  if (SUBDIVISION_LABEL[code]) {
    // Tag sequence: black flag, the subdivision code as tag characters, cancel.
    // Support for these is thinner than for the letter pairs, which is why the
    // label beside it is not optional.
    const tags = [...code].map((ch) => String.fromCodePoint(TAG + ch.charCodeAt(0)));
    return String.fromCodePoint(BLACK_FLAG) + tags.join("") + String.fromCodePoint(CANCEL_TAG);
  }
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return [...code].map((ch) => String.fromCodePoint(A + ch.charCodeAt(0))).join("");
}

// The two-letter label a reader sees when no flag glyph exists. For a real
// country this is the ISO code itself, which is what the fallback already
// draws; for a UK nation the tag sequence carries no letters at all, so one is
// supplied.
export function labelOf(code) {
  if (!code) return null;
  return SUBDIVISION_LABEL[code] ?? code;
}

// null rather than a guess. An unmapped name is a wiki spelling this file has
// not seen, and the fetch logs it so it can be added.
export function codeOf(name) {
  if (!name) return null;
  const t = String(name).trim();
  return SUBDIVISION[t] ?? CODE[t] ?? null;
}

// What the pipeline stores per player: the code is the durable part, the flag
// and label are derived from it and could be recomputed at any time.
export function countryOf(name) {
  const code = codeOf(name);
  if (!code) return null;
  return { name: String(name).trim(), code, flag: flagOf(code), label: labelOf(code) };
}

export const KNOWN_NAMES = Object.freeze([...Object.keys(CODE), ...Object.keys(SUBDIVISION)]);

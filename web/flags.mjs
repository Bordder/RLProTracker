// Flags, drawn rather than typed.
//
// The obvious way to show one is the emoji, and it is the wrong way here:
// Windows ships no flag glyphs at all, so a regional-indicator pair renders as
// the two letters "US". That is the same failure the board hit with player
// nationality, and there the answer was to degrade to readable text. A LAN
// header has room for the real thing, so these are drawn.
//
// Only the countries RLCS actually visits are here. An unknown code returns
// nothing and the caller falls back to the country's name, because a wrong
// flag is worse than no flag.
//
// The designs are national flags: a flag itself carries no copyright, and
// these are drawn here rather than copied from anywhere.

const RATIO = 3 / 2;   // one shape for every chip, whatever the real ratio is

const stars = () => {
  const out = [];
  // Two offset grids, the way the real canton alternates 6 and 5.
  for (let row = 0; row < 5; row++) {
    const y = 2 + row * 2.2;
    const odd = row % 2 === 1;
    for (let col = 0; col < (odd ? 5 : 6); col++) {
      out.push(`<circle cx="${1.6 + col * 1.9 + (odd ? 0.95 : 0)}" cy="${y}" r=".62" fill="#fff"/>`);
    }
  }
  return out.join("");
};

const FLAGS = {
  US: () =>
    `<rect width="30" height="20" fill="#fff"/>` +
    [0, 2, 4, 6, 8, 10, 12].map((i) => `<rect y="${i * 1.538}" width="30" height="1.538" fill="#b22234"/>`).join("") +
    `<rect width="13" height="10.77" fill="#3c3b6e"/>${stars()}`,
  FR: () =>
    `<rect width="30" height="20" fill="#fff"/><rect width="10" height="20" fill="#002395"/>` +
    `<rect x="20" width="10" height="20" fill="#ed2939"/>`,
  DK: () =>
    `<rect width="30" height="20" fill="#c8102e"/><rect x="9" width="4" height="20" fill="#fff"/>` +
    `<rect y="8" width="30" height="4" fill="#fff"/>`,
  GBENG: () =>
    `<rect width="30" height="20" fill="#fff"/><rect x="12.5" width="5" height="20" fill="#ce1124"/>` +
    `<rect y="7.5" width="30" height="5" fill="#ce1124"/>`,
  ES: () =>
    `<rect width="30" height="20" fill="#c60b1e"/><rect y="5" width="30" height="10" fill="#ffc400"/>`,
  DE: () =>
    `<rect width="30" height="20" fill="#000"/><rect y="6.67" width="30" height="6.67" fill="#dd0000"/>` +
    `<rect y="13.33" width="30" height="6.67" fill="#ffce00"/>`,
  NL: () =>
    `<rect width="30" height="20" fill="#21468b"/><rect width="30" height="13.33" fill="#fff"/>` +
    `<rect width="30" height="6.67" fill="#ae1c28"/>`,
  SE: () =>
    `<rect width="30" height="20" fill="#006aa7"/><rect x="9" width="4" height="20" fill="#fecc00"/>` +
    `<rect y="8" width="30" height="4" fill="#fecc00"/>`,
};

// Liquipedia writes the UK nations separately, and the parser keeps that: the
// England flag is a different flag from the Union Jack.
const ALIAS = { GBENG: "GBENG", "GB-ENG": "GBENG", ENG: "GBENG", USA: "US" };

/** An inline SVG flag, or "" when this one is not drawn here. */
export function flagSVG(code, label = "") {
  const key = ALIAS[String(code ?? "").toUpperCase()] ?? String(code ?? "").toUpperCase();
  const draw = FLAGS[key];
  if (!draw) return "";
  const title = label ? ` role="img" aria-label="${label.replace(/[<>&"]/g, "")}"` : ` aria-hidden="true"`;
  return `<svg class="flag" viewBox="0 0 30 20" width="${Math.round(13 * RATIO)}" height="13"${title}>${draw()}</svg>`;
}

export const hasFlag = (code) =>
  Boolean(FLAGS[ALIAS[String(code ?? "").toUpperCase()] ?? String(code ?? "").toUpperCase()]);

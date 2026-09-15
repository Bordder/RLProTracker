// Which match feeds which: the real edge list for a bracket template.
//
// This replaces a guess. The page could only infer feeders when a round was
// exactly half the previous one, which is true of a single-elimination tree
// and false of every double-elimination bracket RLCS uses: the Worlds
// playoffs run 4, 2, 4, 2, 1 as the lower bracket merges in, and the Play-In
// runs 6 then 4. Those steps got no connectors at all, because drawing a
// guessed line is worse than drawing none - a wrong line claims a progression
// that does not exist.
//
// The answer was on Liquipedia's COMMONS wiki all along, not the Rocket
// League one:
//
//   https://liquipedia.net/commons/Template:Bracket/8-2Q-U-4L2D-2Q
//
//   {{TemplateMatch|matchid=R01-M001|header=!u4!x}}
//   {{TemplateMatch|matchid=R02-M001|toupper=R01-M001|tolower=R01-M002}}
//
// toupper and tolower name the two matches that feed this one. That is the
// edge list, stated by the source rather than inferred from shape.
//
// Shapes are immutable: Bracket/8-2Q-U-4L2D-2Q means one thing forever, and a
// new format gets a new name. So each is fetched once and cached under
// shapes/, and the collector never asks again.

import { findTemplates, templateArgs } from "./parseBracket.mjs";

/** "R01-M001" -> "R1M1", the key the page already uses. */
export const slotKey = (id) => {
  const m = /^R0*(\d+)-M0*(\d+)$/.exec(String(id ?? "").trim());
  return m ? `R${m[1]}M${m[2]}` : null;
};

/**
 * Parse a commons bracket template into an edge list.
 *
 * @returns { edges: { [slot]: { upper, lower } }, order: string[] }
 *          where upper/lower are slot keys or null.
 */
export function parseShape(wikitext) {
  const edges = {};
  const order = [];
  for (const t of findTemplates(wikitext, "TemplateMatch")) {
    const { named } = templateArgs(t.body);
    const self = slotKey(named.matchid);
    if (!self) continue;
    order.push(self);
    const upper = slotKey(named.toupper);
    const lower = slotKey(named.tolower);
    // A first-round match has no feeders; record it anyway so the page can
    // tell "no edges defined" from "this template was never fetched".
    //
    // qualwin marks a match whose WINNER leaves this bracket qualified - the
    // whole point of a play-in, and the column Liquipedia draws on the right
    // of one. Without it the Play-In just stops after the semifinals with no
    // statement of who got through.
    edges[self] = { upper, lower, qualifies: /^(t|true|1|yes)$/i.test(named.qualwin ?? "") };
  }
  return { edges, order };
}

/**
 * Feeders for one match, as a flat list of slot keys.
 *
 * Order matters: upper first, then lower, which is the vertical order
 * Liquipedia draws them in.
 */
export const feedersOf = (shape, slot) => {
  const e = shape?.edges?.[slot];
  if (!e) return [];
  return [e.upper, e.lower].filter(Boolean);
};

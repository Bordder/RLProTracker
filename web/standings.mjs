// Group standings: series record and game difference, computed from results.
//
// Liquipedia's {{GroupTableLeague}} carries the finishing ORDER and what each
// place means (up = advances, down = eliminated) but no numbers - it computes
// those from the matches when it renders the page. So does this.
//
// Two sources, each used for what it actually knows:
//
//   the table    the order, and the outcome. Tiebreakers are series, then
//                head-to-head series, then game difference, and the last two
//                cannot be reconstructed reliably, so the published order is
//                taken as given rather than recomputed and argued with.
//   the matches  the numbers. A table that says a team finished second
//                without saying it went 2-1 tells a reader very little.
//
// Pure: no network, no clock.

/** Teams are the same team whatever an editor capitalised. */
export const key = (name) => String(name ?? "").trim().toLowerCase();

/**
 * Win/loss records for one group.
 *
 * @param matches  the group's matches, as parsed
 * @returns Map of team -> { won, lost, played, gamesFor, gamesAgainst, diff }
 */
export function records(matches) {
  const out = new Map();
  const get = (t) => {
    // Keyed case-insensitively, and this is not defensive coding: the Boston
    // Major group table says "Ninjas In Pyjamas" and its own matches say
    // "Ninjas in Pyjamas". Keyed literally, the team shows a 0-0 record
    // beside three matches it actually played.
    const k = key(t);
    if (!out.has(k)) out.set(k, { team: t, won: 0, lost: 0, played: 0, gamesFor: 0, gamesAgainst: 0, diff: 0 });
    return out.get(k);
  };
  for (const m of matches) {
    const [a, b] = m.teams;
    const [x, y] = m.scores;
    // An unplayed match contributes nothing. It must not count as a 0-0 draw:
    // most of a group is unplayed for most of its life.
    //
    // Nor does one being played. Liquipedia fills the score in game by game
    // and sets finished= only when the series ends, so a Bo5 at 2-1 has two
    // scores and no result: counting it gave the leader a win in the table
    // while the series was live. The finished flag decides, as it does in the
    // bracket (see parseMatch in scripts/parseBracket.mjs).
    if (!a || !b || x === null || y === null || !m.finished) continue;
    const ra = get(a), rb = get(b);
    ra.played++; rb.played++;
    ra.gamesFor += x; ra.gamesAgainst += y;
    rb.gamesFor += y; rb.gamesAgainst += x;
    if (x > y) { ra.won++; rb.lost++; } else if (y > x) { rb.won++; ra.lost++; }
  }
  for (const r of out.values()) r.diff = r.gamesFor - r.gamesAgainst;
  return out;
}

/**
 * The table to render: teams ordered by what they did, with the outcome
 * Liquipedia published.
 *
 * The row order in the wikitext is NOT the finishing order - it is the order
 * an editor typed the teams in, and Liquipedia sorts them by results when it
 * renders. The Paris Major Group A lists Team Vitality first and marks
 * Karmine Corp `bg2=up`; Karmine Corp went 3-0 and won the group. Trusting
 * the listed order put the group winner second.
 *
 * So: order by results (series, then game difference, then games won, which
 * is Liquipedia's own tiebreaker list minus the head-to-head step that
 * cannot be reconstructed), and take only the OUTCOME from the table, since
 * whether a place advances is a fact about the format rather than about the
 * results. Ties fall back to the listed order, which keeps the table stable
 * rather than reshuffling on every poll.
 *
 * @param table    one entry from parseGroupTables, or null
 * @param matches  that group's matches
 */
export function standings(table, matches) {
  const recs = records(matches);
  const blank = (team) => ({ team, won: 0, lost: 0, played: 0, gamesFor: 0, gamesAgainst: 0, diff: 0 });

  let rows;
  if (table?.rows?.length) {
    rows = table.rows.map((row, i) => ({
      // The table's spelling wins for display; the record is looked up on the
      // normalised key, so a casing difference cannot lose a team's results.
      ...(row.team ? { ...(recs.get(key(row.team)) ?? blank(row.team)), team: row.team } : blank(null)),
      listed: i,
      outcome: row.outcome,
      meansIfHere: row.meansIfHere,
    }));
  } else {
    rows = [...recs.values()].map((r, i) => ({ ...r, listed: i, outcome: null, meansIfHere: null }));
  }

  rows.sort((a, b) => b.won - a.won || b.diff - a.diff || b.gamesFor - a.gamesFor || a.listed - b.listed);

  // `meansIfHere` is a property of the PLACE, not of the team, so it is
  // reassigned after sorting: "first advances" has to follow first place.
  const byPlace = (table?.rows ?? []).map((r) => r.meansIfHere);
  return rows.map((r, i) => ({ ...r, rank: i + 1, meansIfHere: byPlace[i] ?? r.meansIfHere }));
}

/**
 * Pair each group table with the matchlist that belongs to it.
 *
 * Liquipedia titles them "Group A" and "Group A Matches", so the join is the
 * table title being a prefix of the list title. Falls back to position, which
 * is right on every page checked and is better than showing no table at all.
 */
export function pairGroups(tables = [], matchlists = []) {
  const used = new Set();
  return matchlists.map((list, i) => {
    const listTitle = (list.title ?? "").trim();
    let table = tables.find((t, ti) =>
      !used.has(ti) && t.title && listTitle.toLowerCase().startsWith(t.title.toLowerCase()) && (used.add(ti), true));
    if (!table && tables[i] && !used.has(i)) { table = tables[i]; used.add(i); }
    return { list, table: table ?? null };
  });
}

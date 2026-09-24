// Carry a player's stores across when their roster id changes.
//
//   node scripts/carryIds.mjs tracker    tracker-history, tracker-state, peak-mmr
//   node scripts/carryIds.mjs steam      steam-history
//   DATA_DIR=.databranch/data node ...   act on the data worktree
//
// A roster id is the team and the player (fetchRoster slugs "team-name"), so a
// transfer gives the same person a new id. Nothing carried the old id's stores
// over: the next tracker run dropped the old id's history as off the roster,
// the peak and the scheduling state stayed under a name nobody reads, and the
// player started again from nothing on their new team.
//
// The ids are left as they are. Instead, when an id that is no longer on the
// roster was read from the SAME account (Epic name, or Steam id) as exactly one
// id that is, its entries move to that id and the old one is dropped. The
// account is the evidence it is the same person; a new id with a different
// account, or an account change on an id that stays, is not a transfer and
// moves nothing. More than one candidate either side is ambiguous and is left
// alone rather than guessed.
//
// Runs first in each collector, before anything can drop the old id.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, isAbsolute } from "node:path";

/** The account a roster player is read from, written the way readings write `who`. */
export const accountOf = (p) => (p?.epic ? `epic:${p.epic}` : p?.steamId64 ? `steam:${p.steamId64}` : null);

/** The Steam account alone, for the Steam stores, which never read Epic. */
export const steamOf = (p) => (p?.steamId64 ? `steam:${p.steamId64}` : null);

/**
 * Which old ids move to which roster ids.
 *
 * `held` maps every id a store holds to the account it was last read from (or
 * null). Only ids off the roster move, and only to the one roster id with the
 * same account, when that account also names one old id.
 */
export function planCarry(roster, held, keyOf = accountOf) {
  const onRoster = new Set(roster.map((p) => p.id));
  const add = (map, k, v) => map.set(k, [...(map.get(k) ?? []), v]);
  const current = new Map();
  for (const p of roster) {
    const acc = keyOf(p);
    if (acc) add(current, acc, p.id);
  }
  const orphans = new Map();
  for (const [id, acc] of held) if (acc && !onRoster.has(id)) add(orphans, acc, id);
  const plan = [];
  for (const [acc, from] of orphans) {
    const to = current.get(acc) ?? [];
    if (from.length === 1 && to.length === 1) plan.push({ from: from[0], to: to[0], account: acc });
  }
  return plan.sort((a, b) => a.from.localeCompare(b.from));
}

/** The account an id's newest tracker reading came from. */
export function trackerAccounts(history, peaks) {
  const held = new Map();
  for (const [id, p] of Object.entries(history?.players ?? {})) {
    const newest = [...(p.readings ?? [])].filter((r) => r.who).sort((a, b) => a.t - b.t).pop();
    held.set(id, newest?.who ?? null);
  }
  // An id whose history is gone (retention, a season purge) still has its
  // peaks, and they name the account when there is only one.
  for (const [id, p] of Object.entries(peaks?.players ?? {})) {
    if (held.get(id)) continue;
    const accs = Object.keys(p?.accounts ?? {});
    held.set(id, accs.length === 1 ? accs[0] : null);
  }
  return held;
}

/** The Steam id an id's newest Steam reading came from. */
export function steamAccounts(history) {
  const held = new Map();
  for (const [id, p] of Object.entries(history?.players ?? {})) {
    const newest = [...(p.readings ?? [])].filter((r) => r.steamId64).sort((a, b) => a.t - b.t).pop();
    held.set(id, newest ? `steam:${newest.steamId64}` : null);
  }
  return held;
}

/**
 * A history store with `from`'s readings moved under `to`. The two sets are
 * merged in time order; where both hold a reading at the same time, `to`'s
 * stays. Name and team are the roster's.
 */
export function moveReadings(doc, { from, to }, player = {}) {
  const old = doc?.players?.[from];
  if (!old) return doc;
  const players = { ...doc.players };
  const cur = players[to];
  const byT = new Map((old.readings ?? []).map((r) => [r.t, r]));
  for (const r of cur?.readings ?? []) byT.set(r.t, r);
  players[to] = {
    ...old,
    ...cur,
    name: player.name ?? cur?.name ?? old.name,
    team: player.team ?? cur?.team ?? old.team,
    readings: [...byT.values()].sort((a, b) => a.t - b.t),
  };
  delete players[from];
  return { ...doc, players };
}

/** tracker-state.json, keyed at the top level. `to`'s own fields win. */
export function moveState(doc, { from, to }) {
  if (!doc?.[from]) return doc;
  const out = { ...doc, [to]: { ...doc[from], ...(doc[to] ?? {}) } };
  delete out[from];
  return out;
}

// The higher of two peak entries. Both shapes carry a rating.
const higher = (a, b) => (!a ? b : !b ? a : (b.rating > a.rating ? b : a));
const mergeEntries = (a = {}, b = {}) => {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === "accounts") continue;
    out[k] = higher(a[k], b[k]);
  }
  return out;
};

/** peak-mmr.json: `from`'s peaks folded into `to`'s, the higher of each kept. */
export function movePeaks(doc, { from, to }) {
  const old = doc?.players?.[from];
  if (!old) return doc;
  const cur = doc.players[to] ?? {};
  const merged = mergeEntries(old, cur);
  const whos = new Set([...Object.keys(old.accounts ?? {}), ...Object.keys(cur.accounts ?? {})]);
  if (whos.size) {
    merged.accounts = Object.fromEntries([...whos].map((w) => [w, mergeEntries(old.accounts?.[w], cur.accounts?.[w])]));
  }
  const players = { ...doc.players, [to]: merged };
  delete players[from];
  return { ...doc, players };
}

/** Every move in `plan` applied to the tracker stores. Pure. */
export function carryTracker({ history, state, peaks }, plan, roster) {
  const byId = new Map(roster.map((p) => [p.id, p]));
  for (const m of plan) {
    history = moveReadings(history, m, byId.get(m.to));
    state = moveState(state, m);
    peaks = movePeaks(peaks, m);
  }
  return { history, state, peaks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const DATA = process.env.DATA_DIR
    ? (isAbsolute(process.env.DATA_DIR) ? process.env.DATA_DIR : join(ROOT, process.env.DATA_DIR))
    : join(ROOT, "data");
  const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
  const maybe = (path) => readJson(path).catch(() => null);
  const which = process.argv[2];
  const roster = (await readJson(join(ROOT, "data", "roster.json"))).players ?? [];
  const byId = new Map(roster.map((p) => [p.id, p]));
  const say = (plan) => { for (const m of plan) console.log(`carryIds: ${m.from} -> ${m.to} (${m.account})`); };
  // Written only when something moved, so a normal run touches nothing, and in
  // the layout each store's own writer uses.
  const put = async (path, before, after, text) => {
    if (after && after !== before) await writeFile(path, text(after));
  };
  const LAYOUT = {
    history: (d) => JSON.stringify(d),
    state: (d) => JSON.stringify(d, null, 2),
    peaks: (d) => `${JSON.stringify(d, null, 1)}\n`,
  };

  if (which === "tracker") {
    const paths = {
      history: join(DATA, "tracker-history.json"),
      state: join(DATA, "tracker-state.json"),
      peaks: join(DATA, "peak-mmr.json"),
    };
    const before = { history: await maybe(paths.history), state: await maybe(paths.state), peaks: await maybe(paths.peaks) };
    const plan = planCarry(roster, trackerAccounts(before.history, before.peaks));
    if (plan.length) {
      say(plan);
      const after = carryTracker(before, plan, roster);
      for (const k of Object.keys(paths)) await put(paths[k], before[k], after[k], LAYOUT[k]);
    }
  } else if (which === "steam") {
    const path = join(DATA, "steam-history.json");
    const history = await maybe(path);
    const plan = planCarry(roster, steamAccounts(history), steamOf);
    if (plan.length) {
      say(plan);
      let after = history;
      for (const m of plan) after = moveReadings(after, m, byId.get(m.to));
      await put(path, history, after, LAYOUT.history);
    }
  } else {
    console.error("usage: node scripts/carryIds.mjs tracker|steam");
    process.exit(1);
  }
}

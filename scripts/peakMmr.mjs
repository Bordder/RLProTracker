// The highest rating each player has ever reached, kept where nothing can
// reach it.
//
// Every other figure on the board is DERIVED: tracker.json is rebuilt from
// tracker-history.json on every run, so anything not in the history does not
// exist. That is fine for a current rating and fatal for a peak, because the
// history is deliberately short - 90 days of retention, and emptied outright
// at a season boundary by purgeSeason.mjs. A peak recomputed from history
// would quietly become "the highest rating in the last 90 days", and on the
// morning after a season ends it would become nothing at all.
//
// So this is a STORE rather than a derivation. Each run takes the readings it
// has and keeps the maximum it has ever seen, forward only, and nothing ever
// lowers or clears it. Retention can shorten and the history can be emptied;
// the peak stands.
//
// ALL TIME, not per season. A soft reset drops the whole field into a narrow
// band, so for the first weeks of a new season almost nobody is near their
// peak and the figure sits still. That is the point of it: a mark that only
// moves when somebody actually beats what they have done before is worth more
// than one that restarts every ten weeks.
//
//   node scripts/peakMmr.mjs           what the current history would add
//   node scripts/peakMmr.mjs --apply   write it
//
// The CLI above exists for one job: seeding the store from the history that
// already exists, before that history is thinned or purged. After that the
// collector maintains it on every run and there is nothing to run by hand.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { historyToSnaps } from "./trackerHistory.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STORE = join(ROOT, "data", "peak-mmr.json");
const HISTORY = join(ROOT, "data", "tracker-history.json");

export const PLAYLISTS = { ones: "d1", twos: "d2", threes: "d3" };

// A rating moves by roughly ten to twenty points a match, and the collector
// reads every couple of minutes, so a step of several hundred between two
// consecutive readings is not play. It is the counter moving underneath us:
// an account relinked, a wiki edit pointing at the wrong profile, a playlist
// read from the wrong row.
//
// Any figure would be a guess; this one is a peak, and a peak is a maximum
// that never comes back down. Every other number on the board recovers from a
// bad reading on the next run. This one would carry it forever, which is why
// it is the one number worth refusing outright.
export const MAX_JUMP = 300;

// WHICH ACCOUNT. A player is sometimes read from the wrong account for a while
// - a Steam id Liquipedia attached to somebody else, before the right Epic
// profile is set - and a store that never goes down kept that account's best as
// the player's peak forever. So every entry belongs to the account it was read
// from (the reading's `who`), under `accounts`, and only the player's current
// account is published. Within one account a peak still never goes down.
//
// Entries with no account (recorded before readings carried one, or a reading
// that still has none) live at the top level, as they always did, and count as
// the current account's: the same rule computeTrackerDeltas applies to readings
// with no account, so nothing already earned disappears.
const bucketFor = (held, who) => (who ? ((held.accounts ??= {})[who] ??= {}) : held);

// A player's entries, copied, so that writing to them never reaches the store
// the caller passed in. Only the players map used to be copied and each
// player's entries were written in place, so the CLI's "set or raised" count
// compared the new store with itself.
const copyHeld = (held) => ({
  ...held,
  ...(held?.accounts ? { accounts: Object.fromEntries(Object.entries(held.accounts).map(([w, a]) => [w, { ...a }])) } : null),
});

/**
 * The store, with anything higher in `snaps` folded in.
 *
 * Pure, and it never lowers a value: the whole point is that a peak outlives
 * the readings that produced it. `snaps` is [{ t, rows }] in any order.
 */
export function updatePeaks(store, snaps, opts = {}) {
  const maxJump = opts.maxJump ?? MAX_JUMP;
  const sorted = [...snaps].sort((a, b) => a.t - b.t);
  const players = Object.fromEntries(Object.entries(store?.players ?? {}).map(([id, h]) => [id, copyHeld(h)]));

  // The previous accepted reading per player, account and playlist, for the
  // jump test. Seeded from nothing rather than from the store: the store holds
  // a maximum, not a last value, and a peak set weeks ago says nothing about
  // whether this reading is a plausible step from the one before it. Keyed by
  // account too, because two accounts are two ratings, not a jump between them.
  const last = new Map();

  for (const snap of sorted) {
    for (const row of snap.rows) {
      if (!row.playlists) continue;
      const who = row.who ?? null;
      for (const [key, snapKey] of Object.entries(PLAYLISTS)) {
        // The career best tracker.gg reports, kept beside what we observed
        // ourselves. It is the account's own record rather than a reading, so
        // the jump test below does not apply to it: a best of 3,016 against a
        // current 1,841 is exactly what a season reset looks like, not a bad
        // row. Forward only, like everything else here.
        const best = row.playlists[snapKey]?.best;
        if (Number.isFinite(best?.rating)) {
          const held = bucketFor(players[row.id] ?? (players[row.id] = {}), who);
          const had = held[`${key}Best`];
          if (!had || best.rating > had.rating) held[`${key}Best`] = { rating: best.rating, season: best.season ?? null };
        }

        const rating = row.playlists[snapKey]?.rating;
        if (!Number.isFinite(rating)) continue;

        const seen = `${row.id}|${who ?? ""}|${key}`;
        const prev = last.get(seen);
        // A first reading has nothing to be a jump from, so it is taken as is.
        // Otherwise a leap upward is refused and does not become the new
        // baseline either, so one bad row cannot drag the next one in after it.
        if (prev != null && rating - prev > maxJump) continue;
        last.set(seen, rating);

        const held = bucketFor(players[row.id] ?? (players[row.id] = {}), who);
        if (!held[key] || rating > held[key].rating) {
          held[key] = { rating, at: new Date(snap.t).toISOString() };
        }
      }
    }
  }

  return { ...store, updatedAt: new Date().toISOString(), players };
}

/**
 * Just the ratings, in the shape a published player row wants.
 *
 * `who` is the player's current account. Only its entries are published, with
 * the entries that carry no account counted as its own (see bucketFor).
 */
export function peakFor(store, id, who = null) {
  const held = store?.players?.[id];
  if (!held) return null;
  const mine = who ? held.accounts?.[who] ?? {} : {};
  // The higher of the account's entry and the unattributed one, per key.
  const pick = (k, cmp = (e) => e?.rating) => {
    const a = held[k], b = mine[k];
    if (!a) return b ?? null;
    if (!b) return a;
    return cmp(b) > cmp(a) ? b : a;
  };
  const out = {};
  const season = {};
  const dates = [];
  for (const key of Object.keys(PLAYLISTS)) {
    const obs = pick(key);
    if (obs?.at) dates.push(obs.at);
    const seen = obs?.rating ?? null;
    const best = pick(`${key}Best`);
    // Whichever is higher. The career best normally is; ours wins only when a
    // player has just set a new high that tracker.gg has not folded in yet,
    // and then there is no season to name but the current one.
    if (best && (seen == null || best.rating >= seen)) {
      out[key] = best.rating;
      if (best.season) season[key] = best.season;
    } else if (seen != null) {
      out[key] = seen;
    }
  }
  if (!Object.keys(out).length) return null;
  // When we last saw a new high ourselves. Career bests carry a season, not a
  // time, so they do not count here.
  return { ...out, ...(Object.keys(season).length ? { season } : null), at: dates.sort().pop() ?? null };
}

export const readStore = async (path = STORE) => {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return { players: {} }; }
};

export const writeStore = async (store, path = STORE) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(store, null, 1)}\n`);
};

if (import.meta.main) {

const apply = process.argv.includes("--apply");
const store = await readStore();
const before = Object.keys(store.players ?? {}).length;

let snaps = [];
try {
  snaps = historyToSnaps(JSON.parse(await readFile(HISTORY, "utf8")));
} catch {
  console.error(`no readable ${HISTORY} - nothing to seed from`);
  process.exit(1);
}

const next = updatePeaks(store, snaps);
const after = Object.keys(next.players).length;
let raised = 0;
for (const [id, held] of Object.entries(next.players)) {
  for (const [pl, v] of Object.entries(held)) {
    if ((store.players?.[id]?.[pl]?.rating ?? -Infinity) < v.rating) raised++;
  }
}

console.log(`${apply ? "writing" : "dry run"}  ${STORE}`);
console.log(`  ${snaps.length} snapshots read`);
console.log(`  ${before} players held -> ${after}`);
console.log(`  ${raised} playlist peak(s) set or raised`);

const top = Object.entries(next.players)
  .filter(([, h]) => h.twos)
  .sort((a, b) => b[1].twos.rating - a[1].twos.rating)
  .slice(0, 5);
for (const [id, h] of top) console.log(`  ${id.padEnd(30)} 2v2 ${h.twos.rating} on ${h.twos.at.slice(0, 10)}`);

if (!apply) { console.log("\nnothing written. re-run with --apply."); process.exit(0); }
await writeStore(next);
console.log(`\nwritten. the collector maintains it from here.`);
}

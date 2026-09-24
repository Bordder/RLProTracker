// Shared retention policy for the rolling history files.
//
// Both pipelines have the same shape of problem: a run produces one reading per
// player, and the only questions ever asked of the archive are "what is the
// latest reading" and "what was the reading nearest 24h / 7d / 14d ago". Storing
// a file per run answers those, but grows the repo forever - git keeps every
// blob that was ever committed, so pruning does not reclaim anything. One file
// updated in place stays small and delta-compresses between commits.
//
// Retention: every reading for the last 26 hours, so the 24h window keeps full
// resolution, then at most one per day out to 15 days.

export const HOUR = 3600e3;
export const DAY = 24 * HOUR;
export const FINE_MS = 26 * HOUR;
export const KEEP_MS = 15 * DAY;

// Thin one player's readings. Newest-first so each day bucket keeps its most
// recent reading. The newest reading is always kept however old it is, so a
// player who stops being scraped keeps their last known values rather than
// disappearing from the site.
export function downsampleReadings(readings, now) {
  const sorted = [...readings].filter((r) => r && r.t != null).sort((a, b) => b.t - a.t);
  if (!sorted.length) return [];
  const out = [];
  const seenDay = new Set();
  for (const r of sorted) {
    const age = now - r.t;
    if (age < 0) continue;              // clock skew: ignore readings from the future
    if (age > KEEP_MS) continue;
    if (age <= FINE_MS) { out.push(r); continue; }
    const day = Math.floor(r.t / DAY);
    if (seenDay.has(day)) continue;
    seenDay.add(day);
    out.push(r);
  }
  if (!out.length) out.push(sorted[0]);
  return out.sort((a, b) => a.t - b.t);
}

export function countReadings(history) {
  return Object.values(history?.players ?? {}).reduce((n, p) => n + (p.readings?.length ?? 0), 0);
}

// Collapse runs of readings whose values never changed.
//
// The tracker re-reads every player on a fixed cadence whether or not anything
// moved, and 97% of stored readings were byte-identical to the one before them:
// 51,191 readings, 11.4 MB, for 1,460 actual changes. Keeping only the moments
// a value changed answers every question the site asks, as long as both ends of
// each unchanged run survive.
//
// Both ends, not one, because two different questions are asked of this data:
//
//   "what was the match count 24 hours ago?" reads the newest reading at or
//   before that instant, so the FIRST reading of a run has to stay - it is the
//   one that carries the run's value into the middle of the window.
//
//   "when did this player last finish a game?" reads the gap between two
//   consecutive readings whose counts differ, so the LAST reading of a run has
//   to stay - dropping it would widen that gap from one cadence to the whole
//   run, and the live session times on the board are only as tight as that gap.
//
// Keeping both ends leaves the two computations bit-for-bit identical to what
// they produced over the full series.
const stableKey = (v) =>
  Array.isArray(v)
    ? `[${v.map(stableKey).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stableKey(v[k])).join(",")}}`
      : JSON.stringify(v ?? null);

export function collapseUnchanged(readings) {
  const sorted = [...readings].filter((r) => r && r.t != null).sort((a, b) => a.t - b.t);
  if (sorted.length < 3) return sorted;
  const keyOf = (r) => { const { t, ...rest } = r; return stableKey(rest); };
  const out = [];
  let i = 0;
  while (i < sorted.length) {
    const k = keyOf(sorted[i]);
    let j = i;
    while (j + 1 < sorted.length && keyOf(sorted[j + 1]) === k) j++;
    out.push(sorted[i]);
    if (j !== i) out.push(sorted[j]);
    i = j + 1;
  }
  return out;
}

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

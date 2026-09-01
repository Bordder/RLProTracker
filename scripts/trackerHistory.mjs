// Rolling, downsampled tracker history.
//
// The windowed game counts only ever ask one question per window: "what was
// this player's match count nearest 24h / 7d / 14d ago?". Answering that does
// not need every reading ever taken - it needs a reading near each of those
// ages. Season games and MMR come from the latest reading alone.
//
// Storing one snapshot file per run instead cost ~9 MB/day of committed data at
// a 5-minute cadence (~3.3 GB of git history a year), and pruning does not help:
// git keeps every blob that was ever committed, so the fix has to be writing
// less, not deleting later. One rolling file that is updated in place stays
// small AND delta-compresses well between commits.
//
// Retention: every reading for the last 26 hours (so the 24h window keeps full
// resolution), then at most one per day out to 15 days.

export const HOUR = 3600e3;
export const DAY = 24 * HOUR;
export const FINE_MS = 26 * HOUR;   // keep everything younger than this
export const KEEP_MS = 15 * DAY;    // drop readings older than this

// Thin one player's readings. Newest-first pass so each day bucket keeps its
// most recent reading. The newest reading is always kept, however old it is -
// otherwise a player who stops being scraped would lose their MMR entirely.
export function downsampleReadings(readings, now) {
  const sorted = [...readings].filter((r) => r && r.t != null).sort((a, b) => b.t - a.t);
  if (!sorted.length) return [];
  const out = [];
  const seenDay = new Set();
  for (const r of sorted) {
    const age = now - r.t;
    if (age < 0) continue;                       // clock skew: ignore future readings
    if (age > KEEP_MS) continue;
    if (age <= FINE_MS) { out.push(r); continue; }
    const day = Math.floor(r.t / DAY);
    if (seenDay.has(day)) continue;
    seenDay.add(day);
    out.push(r);
  }
  if (!out.length) out.push(sorted[0]);          // always retain the latest
  return out.sort((a, b) => a.t - b.t);
}

// Fold one run's scraped rows into the history, then downsample. Rows without
// playlist data (failed scrapes) are skipped so a failure never displaces a
// good reading. Returns a new history object.
export function appendRows(history, takenAtMs, rows, now = takenAtMs) {
  const players = { ...(history?.players ?? {}) };
  for (const row of rows ?? []) {
    if (!row?.id || !row.playlists) continue;
    const prev = players[row.id] ?? { name: row.name, team: row.team, readings: [] };
    const readings = prev.readings.filter((r) => r.t !== takenAtMs);
    readings.push({ t: takenAtMs, playlists: row.playlists });
    players[row.id] = {
      name: row.name ?? prev.name,
      team: row.team ?? prev.team,
      readings: downsampleReadings(readings, now),
    };
  }
  // Players not in this run keep their readings, but still get thinned so a
  // dropped player's history cannot grow stale forever.
  for (const [id, p] of Object.entries(players)) {
    if ((rows ?? []).some((r) => r?.id === id && r.playlists)) continue;
    players[id] = { ...p, readings: downsampleReadings(p.readings ?? [], now) };
  }
  return { updatedAt: new Date(takenAtMs).toISOString(), players };
}

// Present the history in the shape computeTrackerDeltas already consumes:
// [{ t, rows: [{ id, name, team, playlists }] }], one entry per distinct time.
export function historyToSnaps(history) {
  const byTime = new Map();
  for (const [id, p] of Object.entries(history?.players ?? {})) {
    for (const r of p.readings ?? []) {
      if (!byTime.has(r.t)) byTime.set(r.t, []);
      byTime.get(r.t).push({ id, name: p.name, team: p.team, playlists: r.playlists });
    }
  }
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, rows]) => ({ t, rows }));
}

export function countReadings(history) {
  return Object.values(history?.players ?? {}).reduce((n, p) => n + (p.readings?.length ?? 0), 0);
}

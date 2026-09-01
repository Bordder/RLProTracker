// Rolling, downsampled Steam playtime history - the Steam-side twin of
// trackerHistory.mjs, sharing its retention policy (see rollingHistory.mjs).
//
// computeSteamPlayers only ever needs the latest reading (total and 2-week
// hours, plus the profile status) and one reading near each window edge, so the
// per-run snapshot files were storing far more than the questions being asked.
// Hourly runs were adding ~102 MB of git history a year for that.

import { downsampleReadings } from "./rollingHistory.mjs";

// Fold one Steam run into the history. Only foreverMin carries forward - a
// reading is kept even when the profile is private (foreverMin null), because
// "we looked and Steam told us nothing" is itself meaningful: it is what marks
// the gap the last-known store then fills.
export function appendSteamRows(history, takenAtMs, rows, now = takenAtMs) {
  const players = { ...(history?.players ?? {}) };
  for (const row of rows ?? []) {
    if (!row?.id) continue;
    const prev = players[row.id] ?? { name: row.name, team: row.team, readings: [] };
    const readings = (prev.readings ?? []).filter((r) => r.t !== takenAtMs);
    readings.push({
      t: takenAtMs,
      status: row.status,
      visibility: row.visibility ?? null,
      foreverMin: row.foreverMin ?? null,
      twoWeeksMin: row.twoWeeksMin ?? null,
      steamId64: row.steamId64 ?? prev.steamId64 ?? null,
    });
    players[row.id] = {
      name: row.name ?? prev.name,
      team: row.team ?? prev.team,
      readings: downsampleReadings(readings, now),
    };
  }
  for (const [id, p] of Object.entries(players)) {
    if ((rows ?? []).some((r) => r?.id === id)) continue;
    players[id] = { ...p, readings: downsampleReadings(p.readings ?? [], now) };
  }
  return { updatedAt: new Date(takenAtMs).toISOString(), players };
}

// Present the history in the { t, rows } shape computeSteamPlayers consumes.
export function historyToSteamSnaps(history) {
  const byTime = new Map();
  for (const [id, p] of Object.entries(history?.players ?? {})) {
    for (const r of p.readings ?? []) {
      if (!byTime.has(r.t)) byTime.set(r.t, []);
      byTime.get(r.t).push({
        id, name: p.name, team: p.team,
        steamId64: r.steamId64 ?? null,
        visibility: r.visibility ?? null,
        status: r.status,
        foreverMin: r.foreverMin ?? null,
        twoWeeksMin: r.twoWeeksMin ?? null,
      });
    }
  }
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, rows]) => ({ t, rows }));
}

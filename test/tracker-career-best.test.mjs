// Reading the career best out of a tracker.gg profile response.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickPlaylists } from "../scripts/fetchTracker.mjs";

const NAMES = { d1: "Ranked Duel 1v1", d2: "Ranked Doubles 2v2" };
const playlist = (name, rating) => ({
  type: "playlist", metadata: { name },
  stats: { rating: { value: rating }, matchesPlayed: { value: 3 }, tier: { metadata: { name: "Supersonic Legend" } } },
});
const peak = (name, value, season) => ({
  type: "peak-rating", metadata: { name }, attributes: { season: 31 },
  stats: { peakRating: { value, metadata: { season } } },
});

test("the peak-rating segment becomes best, with the public season number only", () => {
  const json = { data: { segments: [playlist("Ranked Duel 1v1", 1568), peak("Ranked Duel 1v1", 1808, "Season 17 (31)")] } };
  const out = pickPlaylists(json, NAMES);
  assert.deepEqual(out.d1.best, { rating: 1808, season: "Season 17" });
  assert.equal(out.d1.rating, 1568);
});

test("no peak-rating segment leaves best off the reading entirely", () => {
  const json = { data: { segments: [playlist("Ranked Doubles 2v2", 1841)] } };
  assert.equal("best" in pickPlaylists(json, NAMES).d2, false);
});

test("a peak for another playlist is not borrowed", () => {
  const json = { data: { segments: [playlist("Ranked Duel 1v1", 1568), peak("Ranked Doubles 2v2", 3016, "Season 23 (37)")] } };
  assert.equal("best" in pickPlaylists(json, NAMES).d1, false);
});

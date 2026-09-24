// Removing a player from the collectors' stores.
//
// A removal request is only honoured if the player is gone from every file,
// not just the ones that happen to forget on their own, so each shape of store
// is checked, and so is the promise that nobody else is touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dropKeyed, dropListed, dropTopLevel, dropFromLog } from "../scripts/purgePlayer.mjs";

const gone = new Set(["team-a-gone"]);

test("a keyed store loses the player and keeps everyone else", () => {
  const doc = { updatedAt: "t", players: { "team-a-gone": { x: 1 }, "team-b-stays": { x: 2 } } };
  assert.deepEqual(dropKeyed(doc, gone), { updatedAt: "t", players: { "team-b-stays": { x: 2 } } });
});

test("a derived feed loses the player's row", () => {
  const doc = { computedAt: "t", players: [{ id: "team-a-gone" }, { id: "team-b-stays" }] };
  assert.deepEqual(dropListed(doc, gone).players, [{ id: "team-b-stays" }]);
});

test("collector state keyed at the top level loses the player", () => {
  assert.deepEqual(dropTopLevel({ "team-a-gone": {}, "team-b-stays": { last: "t" } }, gone), { "team-b-stays": { last: "t" } });
});

test("the presence log forgets the player in every poll", () => {
  const log = [
    JSON.stringify({ t: "1", inGame: ["team-a-gone", "team-b-stays"] }),
    JSON.stringify({ t: "2", inGame: ["team-a-gone"] }),
  ].join("\n") + "\n";
  const out = dropFromLog(log, gone);
  assert.ok(!out.includes("team-a-gone"), out);
  assert.equal(out, [
    JSON.stringify({ t: "1", inGame: ["team-b-stays"] }),
    JSON.stringify({ t: "2", inGame: [] }),
  ].join("\n") + "\n");
});

test("a store in a shape it does not know is left alone", () => {
  const doc = { teams: [{ team: "A" }] };
  assert.equal(dropKeyed(doc, gone), doc);
  assert.equal(dropListed(doc, gone), doc);
});

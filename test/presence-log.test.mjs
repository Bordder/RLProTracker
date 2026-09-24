// The presence log is appended to every 5 minutes and committed each time, so
// pruning is what stops it growing without bound in the repo's history.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.STEAM_API_KEY ??= "test-key";
const { prune } = await import("../scripts/pollPresence.mjs");

const line = (daysAgo, ids) =>
  JSON.stringify({ t: new Date(Date.now() - daysAgo * 86400e3).toISOString(), inGame: ids });

async function withLog(contents) {
  const dir = await mkdtemp(join(tmpdir(), "presence-"));
  const path = join(dir, "log.jsonl");
  await writeFile(path, contents);
  return path;
}

test("drops entries older than the retention window", async () => {
  const path = await withLog([line(20, ["a"]), line(16, ["b"]), line(1, ["c"])].join("\n") + "\n");
  assert.equal(await prune(path), 2);
  const kept = (await readFile(path, "utf8")).trim().split("\n");
  assert.equal(kept.length, 1);
  assert.ok(kept[0].includes('"c"'));
});

test("leaves a log that is entirely within the window untouched", async () => {
  const body = [line(3, ["a"]), line(1, ["b"])].join("\n") + "\n";
  const path = await withLog(body);
  assert.equal(await prune(path), 0);
  assert.equal(await readFile(path, "utf8"), body);
});

test("keeps unparseable lines rather than discarding data", async () => {
  const path = await withLog(["not json at all", line(1, ["b"])].join("\n") + "\n");
  await prune(path);
  const kept = (await readFile(path, "utf8")).trim().split("\n");
  assert.equal(kept.length, 2);
});

test("a missing log is not an error", async () => {
  await prune(join(tmpdir(), "definitely-missing", "log.jsonl"));
});

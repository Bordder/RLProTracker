// scripts/publish-data.sh, run against a throwaway local repository standing in
// for the data branch. Nothing here touches the real remote.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const sh = (cmd, cwd) => {
  const r = spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `${cmd}\n${r.stdout}${r.stderr}`);
  return r.stdout;
};
const SCRIPT = resolve("scripts/publish-data.sh");

test("a listed path that exists nowhere does not stop the rest being published", () => {
  // git add aborts the WHOLE add on one pathspec that matches nothing, and the
  // script took that as "no changes to publish" and exited 0: a file published
  // for the first time, missing on this run, silently cost the run everything.
  const root = mkdtempSync(join(tmpdir(), "publish-"));
  const g = "git -c user.name=t -c user.email=t@t -c init.defaultBranch=data";
  sh(`${g} init -q --bare origin.git`, root);
  sh(`${g} clone -q origin.git seed && cd seed && ${g} commit -q --allow-empty -m init && git push -q origin HEAD:data`, root);
  const repo = join(root, "repo");
  mkdirSync(join(repo, "data"), { recursive: true });
  sh(`git clone -q -b data ${join(root, "origin.git")} .databranch`, repo);
  writeFileSync(join(repo, "data", "present.json"), "{}\n");
  const r = spawnSync("bash", [SCRIPT, "test publish", "data/present.json", "data/never-written.json"], { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /published/);
  assert.match(sh("git ls-tree -r --name-only data", join(root, "origin.git")), /data\/present\.json/);
});

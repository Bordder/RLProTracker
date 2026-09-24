// publish-data.sh against a real git remote, on disk.
//
// The case that matters is the ordinary one: the workflow checked the data
// branch out when the job began, another collector has pushed since, and this
// run now publishes. The first push used to be made from the stale checkout, so
// it was rejected every time and the run slept 3-10 seconds before retrying.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve("scripts/publish-data.sh");
const ID = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=data", "-c", "protocol.file.allow=always"];
const git = (cwd, ...args) => execFileSync("git", [...ID, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// A bare remote with a data branch, a job checkout of it (at depth 1, as
// actions/checkout makes it), and a second clone standing in for another
// collector.
function setup() {
  const root = mkdtempSync(join(tmpdir(), "publish-"));
  const remote = join(root, "remote.git");
  git(root, "init", "-q", "--bare", remote);
  const seed = join(root, "seed");
  git(root, "init", "-q", seed);
  mkdirSync(join(seed, "data"), { recursive: true });
  writeFileSync(join(seed, "data", "other.json"), "{\"v\":1}\n");
  git(seed, "add", ".");
  git(seed, "commit", "-q", "-m", "seed");
  git(seed, "push", "-q", remote, "HEAD:data");

  const job = join(root, "job");
  mkdirSync(job);
  git(root, "clone", "-q", "--depth=1", "--branch", "data", `file://${remote}`, join(job, ".databranch"));
  return { root, remote, seed, job };
}

const run = (job, ...paths) => execFileSync("bash", [SCRIPT, "[skip ci] data: test", ...paths], {
  cwd: job, encoding: "utf8",
  env: { ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "protocol.file.allow", GIT_CONFIG_VALUE_0: "always" },
});

test("a checkout that fell behind still publishes on the first push", () => {
  const { root, remote, seed, job } = setup();
  try {
    // Another collector lands while this job is running.
    writeFileSync(join(seed, "data", "other.json"), "{\"v\":2}\n");
    git(seed, "commit", "-q", "-am", "presence");
    git(seed, "push", "-q", remote, "HEAD:data");

    mkdirSync(join(job, "data"), { recursive: true });
    writeFileSync(join(job, "data", "mine.json"), "{\"mine\":true}\n");
    const out = run(job, "data/mine.json");

    assert.match(out, /published to data/);
    assert.doesNotMatch(out, /push retry/, "the first push was rejected");
    // Both collectors' files are on the branch: nothing of theirs was lost.
    const check = join(root, "check");
    git(root, "clone", "-q", "--branch", "data", `file://${remote}`, check);
    assert.equal(readFileSync(join(check, "data", "other.json"), "utf8"), "{\"v\":2}\n");
    assert.equal(readFileSync(join(check, "data", "mine.json"), "utf8"), "{\"mine\":true}\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("nothing changed is still nothing to publish", () => {
  const { root, remote, job } = setup();
  try {
    mkdirSync(join(job, "data"), { recursive: true });
    writeFileSync(join(job, "data", "other.json"), "{\"v\":1}\n");
    const before = git(root, "--git-dir", remote, "rev-parse", "data").trim();
    const out = run(job, "data/other.json");
    assert.match(out, /no changes to publish/);
    assert.equal(git(root, "--git-dir", remote, "rev-parse", "data").trim(), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

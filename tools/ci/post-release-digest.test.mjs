// tools/ci/post-release-digest.test.mjs — tests for the PROD release-digest ANCHOR
// resolver (Issue #2241: the digest anchored on the last release tag that was an
// ancestor of the deployed sha, which skipped every `--ref` hotfix release and made
// the 2026-09-16 post repeat nine already-live notes). `node --test`
// (pnpm test:tools).
//
// There is NO feature-spec behind these ids: #2241 is an engineering-task
// (AGENTS.md §3.8), so the `EARS-N` titles follow the tools/** house convention
// (ADR-0006 §4 numbering style) and reference no spec clause.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  fetchPrevShaInputs,
  resolvePrevSha,
  shouldPost,
  buildReleaseNotesArgs,
} from "./post-release-digest.mjs";

// Every git call is isolated from the developer's global config: a global
// `commit.gpgsign=true` (or an identity-less machine) would otherwise fail these
// temp-repo commits locally while CI stayed green.
const GIT_ISOLATION = [
  "-c",
  "commit.gpgsign=false",
  "-c",
  "tag.gpgsign=false",
  "-c",
  "user.name=t",
  "-c",
  "user.email=t@t",
];

function git(cwd, ...args) {
  const r = spawnSync("git", [...GIT_ISOLATION, ...args], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `git ${args.join(" ")} → ${r.stderr}`);
  return (r.stdout || "").trim();
}

test("EARS-1: the latest release tag wins even when it is a non-ancestor hotfix tag", () => {
  // release-2026.09.09-3 is on main (ancestor of the deployed sha);
  // release-2026.09.15-1 is a `--ref` hotfix release tagged on a side branch.
  const candidates = [
    { tag: "release-2026.09.09-3", sha: "c946a94357fb" },
    { tag: "release-2026.09.15-1", sha: "96c2a41a0000" },
  ];
  assert.equal(
    resolvePrevSha(candidates, "1db3741e1286", "r00t"),
    "96c2a41a0000",
  );
});

test("EARS-1.1: same-day ordinal breaks the tie, order of input is irrelevant", () => {
  const candidates = [
    { tag: "release-2026.09.15-2", sha: "bbb" },
    { tag: "release-2026.09.15-1", sha: "aaa" },
  ];
  assert.equal(resolvePrevSha(candidates, "new", null), "bbb");
});

test("EARS-2: a tag AT the deployed sha is excluded; the prior release anchors", () => {
  const candidates = [
    { tag: "release-2026.09.16-1", sha: "1db3741e1286" },
    { tag: "release-2026.09.15-1", sha: "96c2a41a0000" },
  ];
  assert.equal(
    resolvePrevSha(candidates, "1db3741e1286", "r00t"),
    "96c2a41a0000",
  );
});

test("EARS-2.1: with no qualifying tag the repo-root sha is the baseline, else null", () => {
  assert.equal(resolvePrevSha([], "new", "r00t"), "r00t");
  assert.equal(resolvePrevSha([{ tag: "v1", sha: "x" }], "new", null), null);
  assert.deepEqual(buildReleaseNotesArgs(null, "new"), [
    "--prev-sha",
    "none",
    "--new-sha",
    "new",
  ]);
});

test("EARS-3: fetchPrevShaInputs lists a release tag that lives on a side branch", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-reldigest-"));
  try {
    git(dir, "init", "-q", "-b", "main");
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
    git(dir, "add", "base.txt");
    git(dir, "commit", "-q", "-m", "chore: base (#1)");
    git(dir, "tag", "release-2026.09.09-3");
    const mainRelease = git(dir, "rev-parse", "HEAD");

    // A `deploy:prod --ref <sha>` hotfix: tagged on a SIDE branch, never an
    // ancestor of the main sha that is deployed next.
    git(dir, "checkout", "-q", "-b", "hotfix");
    fs.writeFileSync(path.join(dir, "fix.txt"), "fix\n");
    git(dir, "add", "fix.txt");
    git(dir, "commit", "-q", "-m", "fix(7): hotfix (#77)");
    git(dir, "tag", "release-2026.09.15-1");
    const hotfixTag = git(dir, "rev-parse", "HEAD");

    // main replays the same patch as a squash (alongside one genuinely new file, so
    // the replay is a DIFFERENT commit object) and is deployed. The hotfix tag stays
    // a NON-ANCESTOR of the deployed sha - the whole point of #2241.
    git(dir, "checkout", "-q", "main");
    fs.writeFileSync(path.join(dir, "fix.txt"), "fix\n");
    fs.writeFileSync(path.join(dir, "new.txt"), "new\n");
    git(dir, "add", "fix.txt", "new.txt");
    git(dir, "commit", "-q", "-m", "fix(7): hotfix replay + new (#78)");
    const newSha = git(dir, "rev-parse", "HEAD");
    assert.notEqual(newSha, hotfixTag);
    assert.notEqual(
      spawnSync("git", ["merge-base", "--is-ancestor", hotfixTag, newSha], {
        cwd: dir,
      }).status,
      0,
      "the hotfix tag must NOT be an ancestor of the deployed sha",
    );

    const { candidateTags, repoRootSha } = fetchPrevShaInputs(dir, newSha);
    const tags = candidateTags.map((c) => c.tag).sort();
    assert.deepEqual(tags, ["release-2026.09.09-3", "release-2026.09.15-1"]);
    assert.ok(repoRootSha);

    // …and the resolver anchors on the hotfix release, not on the main one.
    const prev = resolvePrevSha(candidateTags, newSha, repoRootSha);
    assert.equal(prev, hotfixTag);
    assert.notEqual(prev, mainRelease);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("EARS-3.1: a release tag AHEAD of the deployed sha is not an anchor candidate", () => {
  // Rollback (`deploy:prod --ref <older sha>`) or a `workflow_dispatch` backfill:
  // the deployed sha is BEHIND the newest release tag. That newer tag must not
  // anchor the range, or the digest would run backwards over an empty range.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-reldigest-back-"));
  try {
    git(dir, "init", "-q", "-b", "main");
    fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
    git(dir, "add", "a.txt");
    git(dir, "commit", "-q", "-m", "chore: one (#1)");
    git(dir, "tag", "release-2026.09.09-3"); // T1, behind the deployed sha

    fs.writeFileSync(path.join(dir, "b.txt"), "b\n");
    git(dir, "add", "b.txt");
    git(dir, "commit", "-q", "-m", "feat: two (#2)");
    const newSha = git(dir, "rev-parse", "HEAD"); // the sha being re-deployed

    fs.writeFileSync(path.join(dir, "c.txt"), "c\n");
    git(dir, "add", "c.txt");
    git(dir, "commit", "-q", "-m", "feat: three (#3)");
    git(dir, "tag", "release-2026.09.15-1"); // T2, AHEAD of the deployed sha

    const { candidateTags } = fetchPrevShaInputs(dir, newSha);
    const tags = candidateTags.map((c) => c.tag);
    assert.deepEqual(tags, ["release-2026.09.09-3"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("EARS-4: the deployment guard only fires on a successful production deploy", () => {
  assert.equal(
    shouldPost({ state: "success", environment: "production" }),
    true,
  );
  assert.equal(
    shouldPost({ state: "failure", environment: "production" }),
    false,
  );
  assert.equal(shouldPost({ state: "success", environment: "staging" }), false);
  assert.equal(shouldPost(), false);
});

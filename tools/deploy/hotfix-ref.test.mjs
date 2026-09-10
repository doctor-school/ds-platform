// tools/deploy/hotfix-ref.test.mjs — unit tests for the `--ref <sha>` hotfix
// deploy seams (Issue #1881). `node --test` (pnpm test:tools).

import test from "node:test";
import assert from "node:assert/strict";

import {
  parseRefFlag,
  parseCherryOutput,
  hotfixPreflightVerdict,
} from "./hotfix-ref.mjs";

const DEPLOYED = "1455bb9c1455bb9c1455bb9c1455bb9c1455bb9c";
const TARGET = "abcdef01abcdef01abcdef01abcdef01abcdef01";

// ── parseRefFlag ────────────────────────────────────────────────────────────

test("EARS-1: absent --ref yields the default (whole origin/main) deploy", () => {
  const r = parseRefFlag(["node", "prod.mjs"]);
  assert.equal(r.present, false);
  assert.equal(r.ref, null);
  assert.equal(r.error, null);
});

test("EARS-1.1: --ref <sha> parses and normalises to lowercase", () => {
  const r = parseRefFlag(["node", "prod.mjs", "--ref", "ABCDEF01"]);
  assert.deepEqual(r, { present: true, ref: "abcdef01", error: null });
});

test("EARS-1.2: bare --ref is a usage error", () => {
  const r = parseRefFlag(["node", "prod.mjs", "--ref"]);
  assert.equal(r.present, true);
  assert.equal(r.ref, null);
  assert.match(r.error, /requires a <sha> argument/);
});

test("EARS-1.3: --ref followed by another flag is a usage error", () => {
  const r = parseRefFlag(["node", "prod.mjs", "--ref", "--skip-ci-check"]);
  assert.match(r.error, /requires a <sha> argument/);
});

test("EARS-1.4: a non-SHA --ref value (branch name / tag) is refused", () => {
  for (const bad of ["hotfix/1877-header", "release-2026.08.25-2", "zzz"]) {
    const r = parseRefFlag(["node", "prod.mjs", "--ref", bad]);
    assert.equal(r.ref, null, bad);
    assert.match(r.error, /commit SHA/, bad);
  }
});

test("EARS-1.5: --ref together with --rollback is a usage error", () => {
  const r = parseRefFlag([
    "node",
    "prod.mjs",
    "--ref",
    "abcdef01",
    "--rollback",
    "1455bb9c",
  ]);
  assert.match(r.error, /mutually exclusive/);
});

test("EARS-1.6: a repeated --ref is a usage error", () => {
  const r = parseRefFlag([
    "node",
    "prod.mjs",
    "--ref",
    "abcdef01",
    "--ref",
    "beef0001",
  ]);
  assert.match(r.error, /only once/);
});

// ── parseCherryOutput ───────────────────────────────────────────────────────

test("EARS-2: `-` lines are cherry-picks of merged commits, `+` lines are not", () => {
  const out = `- ${TARGET}\n+ ${DEPLOYED}\n`;
  assert.deepEqual(parseCherryOutput(out), {
    unmatched: [DEPLOYED],
    matched: [TARGET],
  });
});

test("EARS-2.1: empty / noise output yields empty lists", () => {
  assert.deepEqual(parseCherryOutput(""), { unmatched: [], matched: [] });
  assert.deepEqual(parseCherryOutput(undefined), {
    unmatched: [],
    matched: [],
  });
  assert.deepEqual(parseCherryOutput("warning: something\n"), {
    unmatched: [],
    matched: [],
  });
});

// ── hotfixPreflightVerdict ──────────────────────────────────────────────────

test("EARS-3: a strict descendant whose commits are all cherry-picks passes", () => {
  const v = hotfixPreflightVerdict({
    deployedSha: DEPLOYED,
    targetSha: TARGET,
    targetIsDescendant: true,
    unmatched: [],
  });
  assert.deepEqual(v, { ok: true, error: null });
});

test("EARS-3.1: target == deployed SHA is refused (nothing to ship)", () => {
  const v = hotfixPreflightVerdict({
    deployedSha: DEPLOYED,
    targetSha: DEPLOYED,
    targetIsDescendant: true,
  });
  assert.equal(v.ok, false);
  assert.match(v.error, /already the deployed SHA/);
});

test("EARS-3.2: a target that is not a descendant of prod is refused", () => {
  const v = hotfixPreflightVerdict({
    deployedSha: DEPLOYED,
    targetSha: TARGET,
    targetIsDescendant: false,
  });
  assert.equal(v.ok, false);
  assert.match(v.error, /not a descendant/);
});

test("EARS-3.3: an unmatched commit (not on origin/main) is refused, named", () => {
  const v = hotfixPreflightVerdict({
    deployedSha: DEPLOYED,
    targetSha: TARGET,
    targetIsDescendant: true,
    unmatched: ["cafebabecafebabecafebabecafebabecafebabe"],
  });
  assert.equal(v.ok, false);
  assert.match(v.error, /no equivalent on origin\/main/);
  assert.match(v.error, /cafebabecafe/);
});

test("EARS-3.4: an unresolvable deployed SHA is refused", () => {
  const v = hotfixPreflightVerdict({
    deployedSha: null,
    targetSha: TARGET,
    targetIsDescendant: true,
  });
  assert.equal(v.ok, false);
  assert.match(v.error, /cannot resolve the live deployed SHA/);
});
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import * as hotfix from "./hotfix-ref.mjs";

function replayFixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "hotfix-proof-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "core.autocrlf", "false");
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const save = () =>
    writeFileSync(join(cwd, "config.txt"), lines.join("\n") + "\n");
  const commit = (message) => {
    git("add", "config.txt");
    git("commit", "-m", message);
    return git("rev-parse", "HEAD");
  };
  save();
  const deployed = commit("base");
  lines[2] = "main context";
  save();
  commit("other main work");
  lines[5] = "version update";
  save();
  const source = commit("reviewed update");
  git("update-ref", "refs/remotes/origin/main", source);
  git("checkout", "-b", "hotfix", deployed);
  git("cherry-pick", "-x", source);
  const target = git("rev-parse", "HEAD");
  return { cwd, git, deployed, source, target };
}

test("EARS-4: exact clean replay accepts context drift rejected by git cherry", (t) => {
  const f = replayFixture(t);
  assert.match(f.git("cherry", "origin/main", f.target, f.deployed), /^\+/);
  const result = hotfix.verifyHotfixCommits(f);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.replayed, [{ target: f.target, source: f.source }]);
  assert.equal(f.git("rev-parse", "HEAD"), f.target);
  assert.equal(f.git("status", "--porcelain"), "");
});

for (const variant of [
  "missing receipt",
  "ambiguous receipt",
  "malformed receipt",
  "unmerged source",
  "extra edit",
  "conflict",
  "merge target",
  "merge source",
]) {
  test(`EARS-5: reject ${variant}`, (t) => {
    const f = replayFixture(t);
    if (variant === "missing receipt")
      f.git("commit", "--amend", "-m", "no provenance");
    if (variant === "ambiguous receipt")
      f.git(
        "commit",
        "--amend",
        "-m",
        `update\n\n(cherry picked from commit ${f.source})\n(cherry picked from commit ${f.source})`,
      );
    if (variant === "malformed receipt")
      f.git(
        "commit",
        "--amend",
        "-m",
        "update\n\n(cherry picked from commit not-a-sha)",
      );
    if (variant === "unmerged source")
      f.git("update-ref", "refs/remotes/origin/main", f.deployed);
    if (variant === "extra edit") {
      writeFileSync(join(f.cwd, "extra.txt"), "unreviewed");
      f.git("add", "extra.txt");
      f.git("commit", "--amend", "--no-edit");
    }
    if (variant === "conflict") {
      f.git("checkout", "-b", "conflict-base", f.deployed);
      const text = f
        .git("show", `${f.deployed}:config.txt`)
        .replace("line 5", "conflicting version");
      writeFileSync(join(f.cwd, "config.txt"), text + "\n");
      f.git("commit", "-am", "conflicting base");
      f.deployed = f.git("rev-parse", "HEAD");
      writeFileSync(
        join(f.cwd, "config.txt"),
        text.replace("conflicting version", "version update") + "\n",
      );
      f.git(
        "commit",
        "-am",
        `manual resolution\n\n(cherry picked from commit ${f.source})`,
      );
    }
    if (variant.startsWith("merge")) {
      const tree = f.git("rev-parse", `${f.target}^{tree}`);
      const merge = f.git(
        "commit-tree",
        tree,
        "-p",
        f.source,
        "-p",
        f.deployed,
        "-m",
        "merge",
      );
      if (variant === "merge target") f.git("reset", "--hard", merge);
      else {
        f.git("update-ref", "refs/remotes/origin/main", merge);
        f.git(
          "commit",
          "--amend",
          "-m",
          `update\n\n(cherry picked from commit ${merge})`,
        );
      }
    }
    f.target = f.git("rev-parse", "HEAD");
    assert.equal(hotfix.verifyHotfixCommits(f).ok, false);
  });
}

test("EARS-6: native equivalent needs no receipt and Git errors fail closed", (t) => {
  const f = replayFixture(t);
  f.git("checkout", "-b", "native", f.git("rev-parse", f.source + "^"));
  f.deployed = f.git("rev-parse", "HEAD");
  writeFileSync(join(f.cwd, "prod-only.txt"), "existing production difference");
  f.git("add", "prod-only.txt");
  f.git("commit", "-m", "production base");
  f.deployed = f.git("rev-parse", "HEAD");
  f.git("cherry-pick", f.source);
  f.target = f.git("rev-parse", "HEAD");
  assert.deepEqual(hotfix.verifyHotfixCommits(f), {
    ok: true,
    error: null,
    replayed: [],
  });
  assert.equal(
    hotfix.verifyHotfixCommits({ ...f, target: "f".repeat(40) }).ok,
    false,
  );
});

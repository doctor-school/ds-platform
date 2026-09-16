// tools/deploy/release-notes.test.mjs — unit + integration tests for the
// aggregated PROD release digest seams (Issue #2241: patch-id range + note-driven
// inclusion). `node --test` (pnpm test:tools).
//
// There is NO feature-spec behind these ids: #2241 is an engineering-task
// (AGENTS.md §3.8), so the `EARS-N` titles follow the tools/** house convention
// (ADR-0006 §4 numbering style) and reference no spec clause. `node --test` rather
// than Vitest because tools/** ships as plain .mjs and runs under `pnpm test:tools`.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  composeDigest,
  extractPrNumbers,
  parseCherryVerbose,
} from "./release-notes.mjs";
import { envFooter } from "../ci/post-product-note.mjs";

const FOOTER = envFooter("prod");

// ── parseCherryVerbose ──────────────────────────────────────────────────────

test("EARS-1: `git cherry -v` keeps `+` subjects and drops `-` (already-live) ones", () => {
  const stdout = [
    "+ 1111111111111111111111111111111111111111 feat(1): brand new (#11)",
    "- 2222222222222222222222222222222222222222 fix(2): already live (#22)",
    "+ 3333333333333333333333333333333333333333 fix(3): also new (#33)",
  ].join("\n");
  const r = parseCherryVerbose(stdout);
  assert.deepEqual(
    r.unmatched.map((e) => e.subject),
    ["feat(1): brand new (#11)", "fix(3): also new (#33)"],
  );
  assert.deepEqual(
    r.matched.map((e) => e.subject),
    ["fix(2): already live (#22)"],
  );
  assert.equal(r.unmatched[0].sha, "1111111111111111111111111111111111111111");
  assert.deepEqual(
    extractPrNumbers(r.unmatched.map((e) => e.subject)),
    [11, 33],
  );
});

test("EARS-1.1: malformed / empty lines are ignored, subjects may be empty", () => {
  const stdout = [
    "",
    "   ",
    "garbage without a marker",
    "* 4444444444444444444444444444444444444444 wrong marker",
    "+ 5555555555555555555555555555555555555555",
    "+ 6666666666666666666666666666666666666666 tooling: keep (#66)",
  ].join("\r\n");
  const r = parseCherryVerbose(stdout);
  assert.deepEqual(
    r.unmatched.map((e) => e.subject),
    ["", "tooling: keep (#66)"],
  );
  assert.deepEqual(r.matched, []);
});

// ── composeDigest: the gh seam ──────────────────────────────────────────────

/** Build a `runGh` stub returning the canned PR JSON for each number. */
function ghStub(prs) {
  return (n) => {
    const pr = prs[String(n)];
    if (!pr) return { status: 1, stdout: "" };
    return { status: 0, stdout: JSON.stringify({ number: Number(n), ...pr }) };
  };
}

test("EARS-3: inclusion is driven by a REAL Product note, not by the kind label", async () => {
  const runGh = ghStub({
    11: {
      title: "refactor(2027): shared auth-flow core",
      url: "https://example.test/11",
      labels: [{ name: "refactor" }],
      body: "## Product note (RU)\n\nЕдиный экран входа на обоих сайтах.\n",
    },
    22: {
      title: "feat(9): something invisible",
      url: "https://example.test/22",
      labels: [{ name: "bug" }],
      body: "## Product note (RU)\n\nnone\n",
    },
  });
  const digest = await composeDigest({
    prevSha: "a".repeat(40),
    newSha: "b".repeat(40),
    footer: FOOTER,
    runCherry: () => ({
      status: 0,
      stdout:
        `+ ${"1".repeat(40)} refactor(2027): shared auth-flow core (#11)\n` +
        `+ ${"2".repeat(40)} feat(9): something invisible (#22)\n`,
    }),
    runGh,
  });
  assert.equal(digest.productCount, 1);
  assert.match(digest.text, /Единый экран входа/);
  assert.doesNotMatch(digest.text, /something invisible/);
});

test("EARS-2.1: a failing `git cherry` is a green skip (null), never a throw", async () => {
  const digest = await composeDigest({
    prevSha: "a".repeat(40),
    newSha: "b".repeat(40),
    footer: FOOTER,
    runCherry: () => ({ status: 128, stdout: "", stderr: "bad object" }),
    runGh: () => assert.fail("gh must not run after a failed range"),
  });
  assert.equal(digest, null);
});

// ── composeDigest: integration over a real temp git repo ────────────────────

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

test("EARS-2: a hotfix-replayed commit is excluded from the range by patch-id", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-relnotes-"));
  try {
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "t@example.test");
    git(dir, "config", "user.name", "Test");
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
    git(dir, "add", "base.txt");
    git(dir, "commit", "-q", "-m", "chore: base (#1)");

    // The hotfix branch carries the fix; prod runs its tip.
    git(dir, "checkout", "-q", "-b", "hotfix");
    fs.writeFileSync(path.join(dir, "fix.txt"), "fix\n");
    git(dir, "add", "fix.txt");
    git(dir, "commit", "-q", "-m", "fix(7): already shipped by hotfix (#77)");
    const hotfixTip = git(dir, "rev-parse", "HEAD");

    // main gets the SAME patch (the merged PR) plus one genuinely new commit.
    git(dir, "checkout", "-q", "main");
    git(dir, "cherry-pick", hotfixTip);
    fs.writeFileSync(path.join(dir, "new.txt"), "new\n");
    git(dir, "add", "new.txt");
    git(dir, "commit", "-q", "-m", "feat(8): genuinely new work (#88)");
    const mainTip = git(dir, "rev-parse", "HEAD");

    const seen = [];
    const runGh = (n) => {
      seen.push(Number(n));
      return ghStub({
        77: {
          title: "fix(7): already shipped by hotfix",
          url: "https://example.test/77",
          labels: [{ name: "bug" }],
          body: "## Product note (RU)\n\nСтарая правка из хотфикса.\n",
        },
        88: {
          title: "feat(8): genuinely new work",
          url: "https://example.test/88",
          labels: [{ name: "feature" }],
          body: "## Product note (RU)\n\nНовая доработка этого релиза.\n",
        },
      })(n);
    };

    const digest = await composeDigest({
      prevSha: hotfixTip,
      newSha: mainTip,
      footer: FOOTER,
      cwd: dir,
      runGh,
    });

    assert.deepEqual(seen, [88], "the replayed PR must never reach gh");
    assert.equal(digest.productCount, 1);
    assert.match(digest.text, /Новая доработка этого релиза/);
    assert.doesNotMatch(digest.text, /Старая правка из хотфикса/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

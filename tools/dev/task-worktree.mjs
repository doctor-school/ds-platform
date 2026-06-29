#!/usr/bin/env node
// DS Platform — clean-start task worktree (parallel-session safe).
//
// Why: the user runs PARALLEL Claude sessions in one repo. The shared main tree
// has ONE HEAD + one uncommitted-change set, so a second session switching the
// branch sweeps the first session's edits into the wrong PR — this happened
// three times in one session (#345: a parallel #334 session swept an ADR-0013
// edit into PR #355). AGENTS.md §6 now makes "worktree-per-session when
// parallel" a hard rule; this helper makes the right action one deterministic
// command instead of a remembered four-step incantation.
//
// Canon: AGENTS.md §6 ("Worktree per session when parallel"); memory
// `feedback_worktree_per_session_when_parallel`. Pairs with the teardown helper
// `pnpm worktree:teardown` (#335). The SessionStart detector in
// `tools/agent-bootstrap.ts` surfaces WHEN to reach for this command.
//
// Usage:
//   node tools/dev/task-worktree.mjs <N> [slug] [prefix]
//   pnpm task:worktree <N>                # alias — derive slug/prefix from gh
//   pnpm task:worktree 359 my-slug feat   # explicit slug + prefix
//
// What it does, in order:
//   1. resolve the main repo root from `git rev-parse --git-common-dir` (so the
//      worktree always lands under the PRIMARY tree's `.claude/worktrees/`, even
//      when invoked from inside another worktree),
//   2. derive slug + prefix from args, else from `gh issue view <N>` (title →
//      slug, kind label → branch prefix),
//   3. refuse early with a clear message if the worktree path or branch exists,
//   4. `git fetch origin <default-branch>` then
//      `git worktree add -b <prefix>/<N>-<slug> .claude/worktrees/<N> origin/<default>`
//      (short numeric path → dodge Windows long-path on deep node_modules,
//      memory `reference_windows_worktree_teardown_longpath`),
//   5. print the next steps (EnterWorktree + `pnpm install`).
//
// Exit codes: 0 = worktree ready; 1 = pre-flight refusal (exists / git error);
// 2 = usage error.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── pure derivation helpers (unit-tested in guard-tests) ────────────────────

/** Map a GitHub kind label to its branch prefix (repo-conventions §Branches). */
const KIND_PREFIX = {
  feature: "feat",
  bug: "fix",
  chore: "chore",
  refactor: "refactor",
  docs: "docs",
  tooling: "tooling",
};

/** First recognized kind label → its branch prefix; `chore` when none match. */
export function branchPrefixFromLabels(labels) {
  for (const l of labels ?? []) {
    if (Object.prototype.hasOwnProperty.call(KIND_PREFIX, l)) {
      return KIND_PREFIX[l];
    }
  }
  return "chore";
}

/**
 * Issue title → branch slug: drop a leading `[tag]`, lowercase, dash every run
 * of non-alphanumerics, trim stray dashes, and cap at six words so the branch
 * name stays short (the path is numeric, but the branch is human-read).
 */
export function slugifyTitle(title) {
  return (title ?? "")
    .replace(/^\s*\[[^\]]*\]\s*/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 6)
    .join("-");
}

/** `<prefix>/<N>-<slug>`. */
export function branchName(prefix, n, slug) {
  return `${prefix}/${n}-${slug}`;
}

/** The short, numeric worktree path (forward-slash, repo-relative for display). */
export function worktreeRelPath(n) {
  return `.claude/worktrees/${n}`;
}

// ── impure CLI (skipped on import) ──────────────────────────────────────────

function out(msg) {
  process.stdout.write(`[task:worktree] ${msg}\n`);
}
function die(msg, code = 2) {
  process.stderr.write(`[task:worktree] ${msg}\n`);
  process.exit(code);
}

/** Run a command, never throw; return {status, stdout, stderr}. */
function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    ...opts,
  });
  return {
    status: res.status ?? -1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    error: res.error,
  };
}

/** The primary working tree's root, even when invoked from a linked worktree. */
function mainRepoRoot() {
  const res = run("git", ["rev-parse", "--git-common-dir"]);
  if (res.status !== 0) {
    die(`not a git repository (git rev-parse failed): ${res.stderr.trim()}`, 1);
  }
  // --git-common-dir → "<root>/.git" (abs in a worktree, ".git" in the primary
  // tree). Resolve against cwd, then the repo root is its parent dir.
  return dirname(resolve(res.stdout.trim()));
}

/** The default branch behind `origin/HEAD`, falling back to `main`. */
function defaultBranch() {
  const res = run("git", ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (res.status === 0) {
    const m = res.stdout.trim().match(/refs\/remotes\/origin\/(.+)$/);
    if (m) return m[1];
  }
  return "main";
}

/** Does a local branch already exist? */
function branchExists(branch) {
  return (
    run("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])
      .status === 0
  );
}

/** Read the issue's title + kind labels via gh, or null if unavailable. */
function fetchIssue(n) {
  const res = run("gh", [
    "issue",
    "view",
    String(n),
    "--json",
    "title,labels",
  ]);
  if (res.status !== 0) return null;
  try {
    const j = JSON.parse(res.stdout);
    return {
      title: j.title ?? "",
      labels: (j.labels ?? []).map((l) => l.name),
    };
  } catch {
    return null;
  }
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const n = args[0];
  if (!n || !/^\d+$/.test(n)) {
    die("Usage: node tools/dev/task-worktree.mjs <issue-number> [slug] [prefix]");
  }
  let slug = args[1];
  let prefix = args[2];

  // Derive any missing slug/prefix from the issue. Args win over gh.
  if (!slug || !prefix) {
    const issue = fetchIssue(n);
    if (!issue) {
      if (!slug) {
        die(
          `could not resolve issue #${n} via gh — pass an explicit slug: pnpm task:worktree ${n} <slug> [prefix]`,
          1,
        );
      }
      // slug given but prefix missing and gh unavailable → safe default.
      prefix = prefix || "chore";
    } else {
      slug = slug || slugifyTitle(issue.title);
      prefix = prefix || branchPrefixFromLabels(issue.labels);
    }
  }
  if (!slug) die(`derived an empty slug for #${n} — pass one explicitly.`, 1);

  const root = mainRepoRoot();
  const branch = branchName(prefix, n, slug);
  const relPath = worktreeRelPath(n);
  const absPath = join(root, ".claude", "worktrees", String(n));

  // Pre-flight: refuse on collisions with a clear remedy (idempotent intent).
  if (existsSync(absPath)) {
    die(
      `worktree path '${relPath}' already exists. Enter it (EnterWorktree path:${relPath}) or tear it down first (pnpm worktree:teardown ${relPath}).`,
      1,
    );
  }
  if (branchExists(branch)) {
    die(
      `branch '${branch}' already exists. Delete it (git branch -D ${branch}) or pass a different slug.`,
      1,
    );
  }

  const base = defaultBranch();
  // Best-effort refresh so the worktree branches from current origin/<default>.
  const fetched = run("git", ["fetch", "origin", base, "--quiet"], {
    cwd: root,
  });
  if (fetched.status !== 0) {
    out(`warning: git fetch origin ${base} failed — branching from the local ref.`);
  }

  const added = run(
    "git",
    ["worktree", "add", "-b", branch, absPath, `origin/${base}`],
    { cwd: root },
  );
  if (added.status !== 0) {
    die(`git worktree add failed: ${added.stderr.trim() || added.stdout.trim()}`, 1);
  }

  out(`created worktree '${relPath}' on branch '${branch}' (off origin/${base}).`);
  out("next steps:");
  out(`  1. EnterWorktree path:${relPath}`);
  out(`  2. pnpm install              # if the task touches code`);
  out(`  3. … do the work, open the PR, then: pnpm worktree:teardown ${relPath}`);
  process.exit(0);
}

// Run only as the entry point — guarding this keeps the pure derivation helpers
// importable from the guard-test harness without firing `main()` / its git+gh
// subprocesses (mirrors agent-bootstrap.ts's IS_ENTRY guard).
const INVOKED = process.argv[1] ? resolve(process.argv[1]) : "";
const SELF = resolve(fileURLToPath(import.meta.url));
if (INVOKED === SELF) {
  main();
}

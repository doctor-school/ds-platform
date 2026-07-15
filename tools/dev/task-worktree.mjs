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
// Two worktree shapes in ONE command:
//   • ISSUE worktree  — `.claude/worktrees/<N>` on `<prefix>/<N>-<slug>`
//     (the default; slug/prefix derived from `gh issue view <N>`).
//   • SPEC worktree   — `.claude/worktrees/spec-NNN` on `feat/spec-NNN-<slug>`
//     (author-ears-spec's spec branches; mirrors the teardown helper's
//     first-class `spec-NNN` vocabulary in `worktree-teardown.mjs`).
//
// Usage:
//   node tools/dev/task-worktree.mjs <N> [slug] [prefix]
//   pnpm task:worktree <N>                     # issue — derive slug/prefix from gh
//   pnpm task:worktree 359 my-slug feat        # issue — explicit slug + prefix
//   pnpm task:worktree --spec 008 portal-shell # spec  — derive path + feat/spec-008-portal-shell
//   pnpm task:worktree spec-008 --branch feat/spec-008-portal-shell  # spec — explicit branch
//
// What it does, in order:
//   1. resolve the main repo root from `git rev-parse --git-common-dir` (so the
//      worktree always lands under the PRIMARY tree's `.claude/worktrees/`, even
//      when invoked from inside another worktree),
//   2. ISSUE mode: derive slug + prefix from args, else from `gh issue view <N>`
//      (title → slug, kind label → branch prefix). SPEC mode: derive the
//      `.claude/worktrees/spec-NNN` path + `feat/spec-NNN-<slug>` branch (or use
//      an explicit `--branch`),
//   3. refuse early with a clear message if the worktree path or branch exists,
//   4. `git fetch origin <default-branch>` then
//      `git worktree add -b <branch> <path> origin/<default>`
//      (short numeric / spec-NNN path → dodge Windows long-path on deep
//      node_modules, memory `reference_windows_worktree_teardown_longpath`),
//   5. print the next steps (EnterWorktree + `pnpm install`).
//
// Exit codes: 0 = worktree ready; 1 = pre-flight refusal (exists / git error);
// 2 = usage error.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── pure derivation helpers (unit-tested in guard-tests) ────────────────────

/**
 * Map a GitHub kind label to its branch prefix (repo-conventions §Branches).
 *
 * Two label families coexist: the bare kinds (`feature`/`bug`/…) and the newer
 * `kind:*` family the board applies to feature-iteration Issues
 * (`kind:ears-handler`, `kind:integration`). Both denote production feature
 * code, so both resolve to `feat` — without the `kind:*` rows an ears-handler
 * Issue fell through to the `chore` default and produced a `chore/` branch on
 * #594 and #550 (#607).
 */
const KIND_PREFIX = {
  feature: "feat",
  "kind:ears-handler": "feat",
  "kind:integration": "feat",
  bug: "fix",
  chore: "chore",
  refactor: "refactor",
  docs: "docs",
  tooling: "tooling",
};

/**
 * First recognized kind label → its branch prefix.
 *
 * Default fallback: `chore` — used only when NO label matches a `KIND_PREFIX`
 * key (an Issue with no kind label at all, or gh being unavailable). It is a
 * deliberately safe, non-`feat` default: a mislabelled maintenance branch is
 * cheaper to rename than a stray `feat/` that trips versioning expectations.
 */
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

// ── spec-worktree derivation (author-ears-spec branches) ────────────────────

/**
 * True when a positional argument is a spec token (`spec-008`, `spec-8`) rather
 * than a bare Issue number. A BARE numeric first positional (`787`) is always
 * the Issue path — backward-compatible — so only the literal `spec-` prefix
 * routes into spec mode from a positional.
 */
export function isSpecToken(arg) {
  return typeof arg === "string" && /^spec-\d+$/i.test(arg);
}

/**
 * Canonical 3-digit spec number from `spec-008` / `008` / `8` (feature specs are
 * `NNN`, three digits — repo-conventions §Branches). Returns null when the input
 * is not a spec identifier, so the caller can fail loud on a typo.
 */
export function parseSpecId(raw) {
  if (typeof raw !== "string") return null;
  const m = raw.match(/^(?:spec-)?(\d+)$/i);
  if (!m) return null;
  return m[1].padStart(3, "0");
}

/** The spec worktree path: `.claude/worktrees/spec-NNN` (mirrors teardown). */
export function specWorktreeRelPath(nnn) {
  return `.claude/worktrees/spec-${nnn}`;
}

/** `feat/spec-NNN-<slug>` — the author-ears-spec branch shape. */
export function specBranchName(nnn, slug) {
  return `feat/spec-${nnn}-${slug}`;
}

/**
 * The post-create "next steps" block for a fresh worktree (`relPath` = its
 * repo-relative path). Returned as a line array so the CLI can prefix each with
 * the `[task:worktree]` tag and the guard-test harness can assert on the copy
 * without firing the git+gh subprocesses in `main()`.
 *
 * A fresh worktree has NO `node_modules`, so simple-git-hooks' pre-commit hook
 * (`lint-staged`) is absent — the FIRST commit (and any test run) fails until
 * `pnpm install` runs. That is a predictable failed-commit round-trip (#941), so
 * the install requirement is an UNCONDITIONAL, visually prominent warning here
 * rather than a skimmable "# if the task touches code" hint.
 */
export function nextStepsLines(relPath) {
  return [
    "next steps:",
    `  1. EnterWorktree path:${relPath}`,
    `  2. pnpm install              # REQUIRED before your first commit (see warning below)`,
    `  3. … do the work, open the PR, then: pnpm worktree:teardown ${relPath}`,
    "",
    "⚠  RUN `pnpm install` IN THE WORKTREE BEFORE YOUR FIRST COMMIT.",
    "⚠  A fresh worktree has no node_modules, so the pre-commit hook (lint-staged)",
    "⚠  is not installed yet — your FIRST COMMIT (and any test run) WILL FAIL until",
    "⚠  you run `pnpm install`.",
  ];
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

/**
 * Shared worktree-creation tail for both modes: refuse on collisions, fetch the
 * default branch, `git worktree add`, print next steps. `relPath` is the
 * repo-relative display path; `absPath` its absolute form under the primary
 * tree; `branch` the branch to create.
 */
function createWorktree(root, relPath, absPath, branch) {
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
  for (const line of nextStepsLines(relPath)) out(line);
  process.exit(0);
}

/**
 * SPEC mode: `.claude/worktrees/spec-NNN` on `feat/spec-NNN-<slug>`.
 * `nnn` is the canonical 3-digit spec number; `slug` derives the branch when no
 * `--branch` override is supplied.
 */
function runSpec(nnn, slug, branchOverride) {
  let branch;
  if (branchOverride) {
    branch = branchOverride;
  } else {
    if (!slug) {
      die(
        `spec worktree needs a slug to derive the branch: pnpm task:worktree --spec ${nnn} <slug> (or pass --branch <name>).`,
        1,
      );
    }
    const s = slugifyTitle(slug);
    if (!s) die(`derived an empty slug for spec-${nnn} — pass a real slug.`, 1);
    branch = specBranchName(nnn, s);
  }

  const root = mainRepoRoot();
  const relPath = specWorktreeRelPath(nnn);
  const absPath = join(root, ".claude", "worktrees", `spec-${nnn}`);
  createWorktree(root, relPath, absPath, branch);
}

/** ISSUE mode: `.claude/worktrees/<N>` on `<prefix>/<N>-<slug>` (default). */
function runIssue(n, slugArg, prefixArg) {
  if (!n || !/^\d+$/.test(n)) {
    die("Usage: node tools/dev/task-worktree.mjs <issue-number> [slug] [prefix]");
  }
  let slug = slugArg;
  let prefix = prefixArg;

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
  createWorktree(root, relPath, absPath, branch);
}

function main() {
  // Flag-aware parse: `--branch <name>`, `--spec <NNN>`, plus positionals.
  const rawArgs = process.argv.slice(2);
  const positional = [];
  let branchOverride = null;
  let specFlag = null;
  let specMode = false;
  for (let i = 0; i < rawArgs.length; i += 1) {
    const a = rawArgs[i];
    if (a === "--branch") branchOverride = rawArgs[(i += 1)];
    else if (a === "--spec") {
      specMode = true;
      specFlag = rawArgs[(i += 1)];
    } else if (a.startsWith("--")) {
      die(`unknown flag '${a}'`);
    } else {
      positional.push(a);
    }
  }

  // Spec mode is entered by `--spec <NNN>` or a literal `spec-NNN` first
  // positional; a bare numeric first positional stays the Issue path.
  if (specMode || isSpecToken(positional[0])) {
    // `--spec 008 <slug>` → NNN from the flag, slug the first positional.
    // `spec-008 [slug]`   → NNN from the positional, slug the second positional.
    let nnn;
    let slug;
    if (specMode) {
      nnn = parseSpecId(specFlag);
      if (!nnn) {
        die(
          `--spec expects a spec number (e.g. pnpm task:worktree --spec 008 <slug>), got '${specFlag ?? ""}'.`,
        );
      }
      slug = positional[0];
    } else {
      nnn = parseSpecId(positional[0]);
      slug = positional[1];
    }
    runSpec(nnn, slug, branchOverride);
    return;
  }

  runIssue(positional[0], positional[1], positional[2]);
}

// Run only as the entry point — guarding this keeps the pure derivation helpers
// importable from the guard-test harness without firing `main()` / its git+gh
// subprocesses (mirrors agent-bootstrap.ts's IS_ENTRY guard).
const INVOKED = process.argv[1] ? resolve(process.argv[1]) : "";
const SELF = resolve(fileURLToPath(import.meta.url));
if (INVOKED === SELF) {
  main();
}

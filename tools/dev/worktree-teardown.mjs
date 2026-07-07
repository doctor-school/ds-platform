#!/usr/bin/env node
// DS Platform — subagent worktree teardown (long-path safe).
//
// Why: a subagent dispatched with `isolation:worktree` that ran `pnpm install`
// leaves a worktree whose deep `node_modules` paths exceed Windows MAX_PATH. So
// `git worktree remove --force <path>` DEREGISTERS the worktree (branch freed)
// but FAILS the filesystem delete with `error: failed to delete '...': Filename
// too long`, leaving an orphan directory that needs an improvised 3-4-step
// `\\?\ rmdir` / robocopy-mirror recovery on every teardown (#335). This helper
// makes each teardown one deterministic command.
//
// Canon: memory `reference_windows_worktree_teardown_longpath` (the recipe this
// promotes) + `feedback_subagent_dispatch_teardown` (the teardown step it wires
// into). On non-Windows the long-path dance is a no-op — plain remove suffices.
//
// Usage:
//   node tools/dev/worktree-teardown.mjs <worktree|path> [--keep-branch] [--branch <name>]
//   pnpm worktree:teardown 598                            # bare name → .claude/worktrees/598
//   pnpm worktree:teardown spec-006                       # bare slug → .claude/worktrees/spec-006
//   pnpm worktree:teardown .claude/worktrees/598          # explicit path (still works)
//
// The argument mirrors `task:worktree` name-resolution (#598): a BARE name (no
// path separator) resolves against the PRIMARY tree's `.claude/worktrees/<name>`
// — so a teardown fired from INSIDE another worktree targets the right tree, not
// the current cwd. An explicit path (absolute or with a separator) is honored
// as-given, and a bare name with nothing under `.claude/worktrees/` also falls
// back to path-as-given.
//
// What it does, in order:
//   1. resolve the worktree's branch from `git worktree list --porcelain`,
//   2. `git worktree remove --force` (tolerating the long-path FS error),
//   3. delete any orphan dir: Windows → `cmd /c rmdir /s /q \\?\<path>` then a
//      robocopy-mirror-from-empty retry; POSIX → fs.rmSync recursive,
//   4. `git worktree prune`,
//   5. branch cleanup (unless --keep-branch): a temp `worktree-agent-*` branch
//      is deleted unconditionally; any other branch only if already merged into
//      main (ancestor check) — an unmerged non-temp branch is kept + warned.
//
// Exit codes: 0 = torn down clean (dir gone, branch handled); 1 = the orphan
// directory could not be removed; 2 = usage error.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

const IS_WIN = process.platform === "win32";

function out(msg) {
  process.stdout.write(`[worktree-teardown] ${msg}\n`);
}
function warn(msg) {
  process.stderr.write(`[worktree-teardown] WARN: ${msg}\n`);
}
function die(msg, code = 2) {
  process.stderr.write(`[worktree-teardown] ${msg}\n`);
  process.exit(code);
}

/** Run a command, never throw; return {status, stdout, stderr}. */
function run(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: "utf8" });
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    error: res.error,
  };
}

/** Normalize a path for cross-tool comparison (lowercase, forward slashes). */
const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/**
 * The primary working tree's root, even when invoked from inside a linked
 * worktree (mirrors task-worktree.mjs). Returns null if not resolvable (not a
 * git repo) — bare-name resolution then falls back to path-as-given.
 */
function mainRepoRoot() {
  const res = run("git", ["rev-parse", "--git-common-dir"]);
  if (res.status !== 0) return null;
  // --git-common-dir → "<root>/.git" — resolve against cwd, root is its parent.
  return dirname(resolve(res.stdout.trim()));
}

/**
 * Resolve the teardown argument to an absolute worktree path, mirroring
 * `task:worktree` name-resolution (#598). A BARE name (no path separator, not
 * absolute) resolves against the PRIMARY tree's `.claude/worktrees/<name>`, so
 * `pnpm worktree:teardown <slug>` fired from inside another worktree targets the
 * right tree rather than the current cwd. An explicit path (absolute or
 * containing a separator) is honored as-given, and a bare name with nothing
 * under `.claude/worktrees/` also falls back to path-as-given.
 *
 * Pure + injectable (`root`, `exists`) so the guard-test harness can drive it
 * without a git subprocess or a real filesystem.
 */
export function resolveWorktreePath(rawArg, root, exists = existsSync) {
  if (isAbsolute(rawArg) || /[\\/]/.test(rawArg)) return resolve(rawArg);
  if (root) {
    const candidate = join(root, ".claude", "worktrees", rawArg);
    if (exists(candidate)) return candidate;
  }
  return resolve(rawArg);
}

/** Find the branch checked out in the worktree at `absPath`, or null (detached). */
function resolveWorktreeBranch(absPath) {
  const res = run("git", ["worktree", "list", "--porcelain"]);
  if (res.status !== 0) return null;
  const want = norm(absPath);
  let current = null;
  for (const line of res.stdout.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      current = norm(line.slice("worktree ".length));
    } else if (line.startsWith("branch ") && current === want) {
      return line.slice("branch ".length).replace(/^refs\/heads\//, "");
    }
  }
  return null;
}

/** Windows long-path-aware directory purge. Returns true if the dir is gone. */
function purgeDirWindows(absPath) {
  const winPath = win32.normalize(absPath);
  const longPath = `\\\\?\\${winPath}`;
  // Pass 1 — \\?\ bypasses MAX_PATH; usually enough.
  run("cmd", ["/c", "rmdir", "/s", "/q", longPath]);
  if (!existsSync(absPath)) return true;
  // Pass 2 — empty the tree with robocopy /MIR from a fresh empty dir, then retry.
  // robocopy exit codes < 8 are success-ish (1/2/3 = copied/extra/mismatch).
  const empty = mkdtempSync(join(tmpdir(), "wt-empty-"));
  try {
    run("robocopy", [
      empty,
      winPath,
      "/MIR",
      "/NFL",
      "/NDL",
      "/NJH",
      "/NJS",
      "/NC",
      "/NS",
    ]);
    run("cmd", ["/c", "rmdir", "/s", "/q", longPath]);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
  return !existsSync(absPath);
}

function purgeDir(absPath) {
  if (!existsSync(absPath)) return true;
  if (IS_WIN) return purgeDirWindows(absPath);
  rmSync(absPath, { recursive: true, force: true });
  return !existsSync(absPath);
}

function cleanupBranch(branch) {
  if (!branch) {
    out("worktree was detached (no branch) — nothing to delete.");
    return;
  }
  if (/^worktree-agent-/.test(branch)) {
    const res = run("git", ["branch", "-D", branch]);
    if (res.status === 0) out(`deleted temp isolation branch '${branch}'.`);
    else warn(`could not delete temp branch '${branch}': ${res.stderr.trim()}`);
    return;
  }
  // Non-temp branch: only delete if already merged into main (safe).
  const merged = run("git", ["merge-base", "--is-ancestor", branch, "main"]);
  if (merged.status === 0) {
    const res = run("git", ["branch", "-d", branch]);
    if (res.status === 0) out(`deleted merged branch '${branch}'.`);
    else
      warn(`could not delete merged branch '${branch}': ${res.stderr.trim()}`);
  } else {
    warn(
      `branch '${branch}' is not merged into main — kept (delete by hand if intended, or pass --branch to override).`,
    );
  }
}

function main() {
  const args = process.argv.slice(2);
  let keepBranch = false;
  let branchOverride = null;
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--keep-branch") keepBranch = true;
    else if (a === "--branch")
      branchOverride = args[(i += 1)]; // consume the value
    else if (a.startsWith("--")) die(`unknown flag '${a}'`);
    else positional.push(a);
  }

  if (positional.length !== 1) {
    die(
      "Usage: node tools/dev/worktree-teardown.mjs <worktree|path> [--keep-branch] [--branch <name>]",
    );
  }
  const absPath = resolveWorktreePath(positional[0], mainRepoRoot());

  // 1. Capture the branch before removal deregisters the worktree.
  const branch = branchOverride ?? resolveWorktreeBranch(absPath);

  // 2. Deregister via git (tolerate the long-path FS-delete failure).
  const removed = run("git", ["worktree", "remove", "--force", absPath]);
  if (removed.status === 0) {
    out(`git deregistered + removed worktree '${absPath}'.`);
  } else if (/filename too long|failed to delete/i.test(removed.stderr)) {
    out(
      `git deregistered worktree '${absPath}' (FS delete hit the long-path limit — purging below).`,
    );
  } else if (/is not a working tree|No such/i.test(removed.stderr)) {
    warn(
      `'${absPath}' is not a registered worktree — purging any orphan dir anyway.`,
    );
  } else if (removed.status !== 0) {
    warn(
      `git worktree remove returned ${removed.status}: ${removed.stderr.trim()}`,
    );
  }

  // 3. Purge any orphan directory left on disk.
  if (existsSync(absPath)) {
    if (purgeDir(absPath)) out(`purged orphan directory '${absPath}'.`);
    else
      die(
        `could not remove orphan directory '${absPath}' — remove by hand.`,
        1,
      );
  } else {
    out("no orphan directory left on disk.");
  }

  // 4. Prune stale worktree administrative entries.
  run("git", ["worktree", "prune"]);
  out("git worktree prune done.");

  // 5. Branch cleanup.
  if (keepBranch)
    out(`--keep-branch: leaving branch '${branch ?? "(detached)"}' in place.`);
  else cleanupBranch(branch);

  out(`teardown complete for '${absPath}'.`);
  process.exit(0);
}

// Run only as the entry point — the IS_ENTRY guard keeps `resolveWorktreePath`
// importable from the guard-test harness without firing `main()` / its
// git + filesystem side effects (mirrors task-worktree.mjs).
const INVOKED = process.argv[1] ? resolve(process.argv[1]) : "";
const SELF = resolve(fileURLToPath(import.meta.url));
if (INVOKED === SELF) {
  main();
}

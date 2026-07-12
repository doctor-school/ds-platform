#!/usr/bin/env node
/**
 * tools/gh/dispatch-probe.mjs — background-dispatch liveness checkpoint (#744).
 *
 * Why: subagent-liveness monitoring is a 4-recurrence retro theme (#548, #545,
 * #539, #732) — every prior fix was prose (CLAUDE.md rule 6, dev-stand
 * bullets), and the #728 session still burned 123K tokens waiting on a
 * zero-output background dispatch. The rule says "after a bounded interval,
 * probe the worktree; still-clean ≈10 min in = kill + re-dispatch" but left the
 * lead hand-rolling `git -C <worktree> log/status` incantations. This script
 * makes that checkpoint one deterministic command with a machine-parseable
 * verdict, so the lead reports only observed artifacts and never "waits for the
 * notification".
 *
 * Canon: CLAUDE.md → Subagent context economy, rule 6. Natural sibling of
 * `tools/gh/handoff-verify.mjs` (#743) — same deterministic-gate family (pure
 * exported classifier + injectable runner so the core is unit-tested without
 * shelling out).
 *
 * Usage:
 *   pnpm dispatch:probe <N>       # inspect .claude/worktrees/<N>
 *
 * What it observes in the worktree (all "since dispatch" — the worktree was
 * created off origin/main with zero commits ahead):
 *   - commit count:  `git rev-list --count origin/main..HEAD` — the subagent's
 *     own commits (a durable produced artifact).
 *   - dirty count:   `git status --porcelain` non-empty lines — uncommitted
 *     edits in flight.
 *   - age (seconds since last activity): last commit time when there are
 *     commits, else newest mtime among dirty files, else the worktree `.git`
 *     link-file mtime (a dispatch-time proxy, written once at `worktree add`).
 *
 * Verdict (pure `classifyVerdict`, unit-tested — this is the core):
 *   - ALIVE       — commits since dispatch, OR dirty edits touched within the
 *                   threshold (active progress). No age shown; it's moving.
 *   - QUIET <age> — no commits, dirty files present but none touched within the
 *                   threshold (work started, then went quiet). age = since last
 *                   file mtime.
 *   - STILL-CLEAN <age> — no commits AND no dirty files. age = since dispatch;
 *                   at age ≥ threshold (≈10 min, CLAUDE.md rule 6) the line
 *                   carries `advice=kill+re-dispatch`.
 * The single `thresholdSeconds` (default 600) does double duty: the freshness
 * cutoff that separates an actively-edited dirty tree (ALIVE) from a stalled
 * one (QUIET), and the kill-advice cutoff for a clean tree.
 *
 * Output (one machine-parseable line):
 *   <VERDICT> #<N> age=<age> commits=<c> dirty=<d>[ advice=kill+re-dispatch]
 *
 * Exit codes: 0 = probe ran and classified — for EVERY verdict, ALIVE / QUIET /
 * STILL-CLEAN alike. The exit code reflects whether the PROBE succeeded, not
 * task health: STILL-CLEAN is a real advisory state the lead reads off stdout,
 * not a tool failure, and a non-zero there would falsely signal the probe
 * itself broke and poison any `&&`-chained scripting. 2 = usage / input error
 * (missing or non-numeric <N>, or the worktree path does not exist). Auto-kill
 * / auto-re-dispatch is deliberately OUT of scope — the verdict informs the
 * lead; the action stays a lead decision.
 *
 * Pure node, no bash-isms — runs on Windows/PowerShell and POSIX alike (path
 * joins via node:path, git via spawnSync with an explicit cwd). The classifier,
 * age formatter, porcelain parser and evidence gatherer are exported for unit
 * tests (tools/lint/guard-tests/dispatch-probe.spec.ts); all `git` calls and
 * fs.stat go through injectable seams so tests never shell out.
 */
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MAX_BUFFER = 16 * 1024 * 1024;

/** The ≈10-min rule from CLAUDE.md rule 6 (Subagent context economy). */
export const STALE_THRESHOLD_SECONDS = 10 * 60;

/**
 * Classify a dispatch's liveness from three observed scalars.
 * @param {object} o
 * @param {number} o.commitCount  commits on the branch since dispatch.
 * @param {number} o.dirtyCount   uncommitted (modified/staged/untracked) files.
 * @param {number} o.ageSeconds   seconds since the last observed activity.
 * @param {number} [o.thresholdSeconds]  freshness / kill-advice cutoff.
 * @returns {{verdict: "ALIVE"|"QUIET"|"STILL-CLEAN", killAdvised: boolean}}
 */
export function classifyVerdict({
  commitCount,
  dirtyCount,
  ageSeconds,
  thresholdSeconds = STALE_THRESHOLD_SECONDS,
}) {
  // Any commit since dispatch is durable evidence the subagent produced work.
  if (commitCount > 0) return { verdict: "ALIVE", killAdvised: false };
  // Dirty files with no commits: recent edits ⇒ still working; aged ⇒ went quiet.
  if (dirtyCount > 0) {
    return ageSeconds < thresholdSeconds
      ? { verdict: "ALIVE", killAdvised: false }
      : { verdict: "QUIET", killAdvised: false };
  }
  // Nothing at all: STILL-CLEAN; advise kill + re-dispatch once past the cutoff.
  return {
    verdict: "STILL-CLEAN",
    killAdvised: ageSeconds >= thresholdSeconds,
  };
}

/** Compact, sortable age: `45s`, `9m`, `9m47s`, `1h5m`. */
export function formatAge(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h${mm}m` : `${h}h`;
}

/**
 * Extract the working-tree path from one `git status --porcelain` line.
 * Format is `XY <path>` (columns 0-1 = status, col 2 = space), and for renames
 * `XY <orig> -> <path>` — the destination is the live file to stat.
 * @param {string} line
 * @returns {string} repo-relative path (quotes stripped)
 */
export function parsePorcelainPath(line) {
  let p = line.slice(3);
  const arrow = p.indexOf(" -> ");
  if (arrow !== -1) p = p.slice(arrow + 4);
  // git quotes paths with special chars in double quotes — drop them.
  if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
  return p;
}

/**
 * Gather the three liveness scalars for a worktree via injected seams.
 * @param {object} o
 * @param {string} o.worktreePath  absolute path to `.claude/worktrees/<N>`.
 * @param {{git: (cwd: string, args: string[]) => {status:number, stdout:string, stderr:string}}} o.runner
 * @param {(p: string) => number|null} o.statMtime  mtime in ms, or null if missing.
 * @param {number} o.nowMs
 * @returns {{commitCount: number, dirtyCount: number, ageSeconds: number}}
 */
export function gatherEvidence({ worktreePath, runner, statMtime, nowMs }) {
  // Commits since dispatch: reachable from HEAD but not origin/main.
  let commitCount = 0;
  const rl = runner.git(worktreePath, [
    "rev-list",
    "--count",
    "origin/main..HEAD",
  ]);
  if (rl.status === 0) commitCount = Number(rl.stdout.trim()) || 0;

  // Dirty files (modified/staged/untracked).
  const st = runner.git(worktreePath, ["status", "--porcelain"]);
  const dirtyPaths =
    st.status === 0
      ? st.stdout
          .split(/\r?\n/)
          .filter((l) => l.trim().length > 0)
          .map(parsePorcelainPath)
      : [];
  const dirtyCount = dirtyPaths.length;

  // Last-activity timestamp → age.
  let lastActivityMs;
  if (commitCount > 0) {
    const ct = runner.git(worktreePath, ["log", "-1", "--format=%ct", "HEAD"]);
    const secs = ct.status === 0 ? Number(ct.stdout.trim()) : NaN;
    lastActivityMs = Number.isFinite(secs) ? secs * 1000 : nowMs;
  } else if (dirtyCount > 0) {
    const mtimes = dirtyPaths
      .map((p) => statMtime(join(worktreePath, p)))
      .filter((m) => typeof m === "number");
    lastActivityMs = mtimes.length > 0 ? Math.max(...mtimes) : nowMs;
  } else {
    // Clean tree: the worktree `.git` link-file is written once at creation.
    lastActivityMs = statMtime(join(worktreePath, ".git")) ?? nowMs;
  }
  const ageSeconds = Math.max(0, (nowMs - lastActivityMs) / 1000);
  return { commitCount, dirtyCount, ageSeconds };
}

/** Format the one-line verdict for stdout. */
export function formatLine(n, evidence, decision) {
  const { verdict, killAdvised } = decision;
  const { commitCount, dirtyCount, ageSeconds } = evidence;
  const parts = [
    verdict,
    `#${n}`,
    `age=${formatAge(ageSeconds)}`,
    `commits=${commitCount}`,
    `dirty=${dirtyCount}`,
  ];
  if (killAdvised) parts.push("advice=kill+re-dispatch");
  return parts.join(" ");
}

// ── impure CLI (skipped on import) ──────────────────────────────────────────

/** Default runner — real `git` via spawnSync with an explicit cwd (Windows-safe). */
export function defaultRunner() {
  return {
    git: (cwd, args) => {
      const res = spawnSync("git", args, {
        cwd,
        encoding: "utf8",
        maxBuffer: MAX_BUFFER,
      });
      if (res.error)
        throw new Error(`failed to spawn git: ${res.error.message}`);
      return {
        status: res.status ?? 1,
        stdout: res.stdout ?? "",
        stderr: res.stderr ?? "",
      };
    },
  };
}

/** Default mtime seam: mtime in ms, or null if the path does not exist. */
function defaultStatMtime(p) {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

/** The primary working tree's root, even when invoked from a linked worktree. */
function mainRepoRoot() {
  const res = spawnSync("git", ["rev-parse", "--git-common-dir"], {
    encoding: "utf8",
  });
  if (res.status !== 0 || !res.stdout) return null;
  // --git-common-dir → "<root>/.git" (abs in a worktree, ".git" in the primary
  // tree). Resolve against cwd, then the repo root is its parent dir.
  return dirname(resolve(res.stdout.trim()));
}

function die(msg) {
  process.stderr.write(`[dispatch:probe] ${msg}\n`);
  process.exit(2);
}

function main() {
  const n = process.argv[2];
  if (!n || !/^\d+$/.test(n)) {
    die("Usage: pnpm dispatch:probe <issue-number>");
  }
  const root = mainRepoRoot();
  if (!root)
    die("not a git repository (git rev-parse --git-common-dir failed).");

  const worktreePath = join(root, ".claude", "worktrees", String(n));
  if (defaultStatMtime(worktreePath) == null) {
    die(
      `no worktree at '.claude/worktrees/${n}'. Create it (pnpm task:worktree ${n}) or check the number.`,
    );
  }

  const evidence = gatherEvidence({
    worktreePath,
    runner: defaultRunner(),
    statMtime: defaultStatMtime,
    nowMs: Date.now(),
  });
  const decision = classifyVerdict(evidence);
  process.stdout.write(`${formatLine(n, evidence, decision)}\n`);
  process.exit(0);
}

// Run main only when invoked directly, so the pure functions can be imported in
// tests. `pathToFileURL` yields canonical `file:///C:/…` on Windows too.
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const selfPath = resolve(fileURLToPath(import.meta.url));
if (
  invokedPath &&
  invokedPath === selfPath &&
  import.meta.url === pathToFileURL(invokedPath).href
) {
  main();
}

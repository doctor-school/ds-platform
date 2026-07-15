#!/usr/bin/env node
/**
 * tools/gh/merge-when-green.mjs — merge a PR only after the deterministic merge
 * gate goes GREEN, as a REAL barrier (#928).
 *
 * Why: the natural-language merge step was written as a chained shell one-liner
 * (`pnpm merge:gate <N> | tail && gh pr merge …`). A pipe makes the shell
 * observe the LAST stage's exit status — `tail`'s `0` — not the gate's, so a RED
 * gate (exit 1) could not block the `&&`-chained `gh pr merge`. This wrapper
 * closes that gap: it runs the gate as its OWN statement (no pipe, no `&&`),
 * checks its exit code EXPLICITLY via the pure `shouldMerge` seam, and spawns
 * `gh pr merge` ONLY on exit 0. Any non-zero gate exit (RED / TIMEOUT / worktree
 * refusal) is propagated and no merge is attempted.
 *
 * The wrapper additionally refuses from a worktree cwd BEFORE spawning the gate
 * (the same `isWorktreeCwd` guard the gate enforces, exit 4) — a merge runs from
 * the MAIN tree (`gh pr merge --delete-branch` cannot delete a branch a worktree
 * holds; skill merge-when-green Step 2/2a).
 *
 * Usage:
 *   node tools/gh/merge-when-green.mjs <pr#> [--timeout <sec>] [--interval <sec>] [--reg-timeout <sec>]
 *   pnpm merge:when-green <pr#>                          # alias
 *
 * Extra flags after <pr#> are forwarded verbatim to `merge:gate`.
 *
 * Exit codes: 0 = merged (gate GREEN + gh merge succeeded); the gate's exit code
 * on a non-green gate (1 = RED, 2 = TIMEOUT, 4 = worktree refusal); 3 = usage /
 * spawn error; on a green gate but a failed `gh pr merge`, gh's exit code.
 *
 * Canon: AGENTS.md §4, skill `merge-when-green` Steps 1–2, memory
 * `feedback_no_pipe_exit_significant_commands`. Issue #928.
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { cwdGuardMessage, isWorktreeCwd } from "./merge-gate.mjs";

const TAG = "[merge:when-green]";

// ── pure seam (unit-tested in guard-tests/merge-when-green.spec.ts) ──────────

/**
 * The merge decision: proceed to `gh pr merge` ONLY when the merge gate exited
 * 0 (GREEN). Every other exit code — 1 (RED), 2 (TIMEOUT), 4 (worktree refusal),
 * or a null status from a spawn failure — is not-green and must NOT merge. This
 * is the barrier the piped `merge:gate | tail && gh pr merge` chain lost: the
 * shell there observed `tail`'s exit, this reads the gate's exit explicitly.
 * @param {number|null|undefined} gateExitCode
 * @returns {boolean}
 */
export function shouldMerge(gateExitCode) {
  return gateExitCode === 0;
}

// ── impure CLI (skipped on import) ──────────────────────────────────────────

function die(msg, code = 3) {
  process.stderr.write(`${TAG} ${msg}\n`);
  process.exit(code);
}

/** Default runner: spawn the merge gate as its own process, streaming output. */
function runGate(pr, extraArgs) {
  return spawnSync(
    "node",
    ["tools/gh/merge-gate.mjs", String(pr), ...extraArgs],
    { stdio: "inherit" },
  );
}

/** Default runner: spawn the Phase-0 squash-merge, streaming output. */
function runMerge(pr) {
  return spawnSync(
    "gh",
    ["pr", "merge", String(pr), "--squash", "--delete-branch"],
    { stdio: "inherit" },
  );
}

/**
 * Orchestrate the gate → merge barrier. The two spawns are injectable so the
 * guard-test can stub them (no real `node`/`gh` subprocess); production passes
 * the real `runGate`/`runMerge`.
 *
 * @param {number} pr
 * @param {string[]} extraArgs  flags forwarded to the gate
 * @param {{gate?: typeof runGate, merge?: typeof runMerge, exit?: (code: number) => never, log?: (msg: string) => void, err?: (msg: string) => void}} [io]
 * @returns {never}
 */
export function mergeWhenGreen(pr, extraArgs = [], io = {}) {
  const gate = io.gate ?? runGate;
  const merge = io.merge ?? runMerge;
  const exit = io.exit ?? ((code) => process.exit(code));
  const log = io.log ?? ((msg) => process.stdout.write(msg));
  const err = io.err ?? ((msg) => process.stderr.write(`${TAG} ${msg}\n`));

  // 1. Run the gate as its OWN statement — no pipe, no `&&` (the #928 root cause).
  const gateRes = gate(pr, extraArgs);
  if (gateRes.error) {
    err(
      `failed to spawn the merge gate: ${gateRes.error.message} (is node on PATH?)`,
    );
    return exit(3);
  }
  const gateExit = gateRes.status;

  // 2. Check the gate's exit code EXPLICITLY. Merge ONLY on green (exit 0).
  if (!shouldMerge(gateExit)) {
    err(
      `merge gate did not go GREEN for PR #${pr} (gate exit ${gateExit}) — NOT merging. ` +
        `Investigate the gate's terminal RED/TIMEOUT line above.`,
    );
    // Propagate the gate's own exit code (1 RED / 2 TIMEOUT / 4 refusal); a
    // non-numeric status (spawn quirk) collapses to a usage/spawn error.
    return exit(typeof gateExit === "number" ? gateExit : 3);
  }

  log(`${TAG} gate GREEN for PR #${pr} — merging (squash, delete-branch)…\n`);
  const mergeRes = merge(pr);
  if (mergeRes.error) {
    err(`failed to spawn gh pr merge: ${mergeRes.error.message}`);
    return exit(3);
  }
  return exit(mergeRes.status ?? 0);
}

function main() {
  const args = process.argv.slice(2);
  const rawPr = args[0];
  const prNumber = Number(rawPr);
  if (!rawPr || !Number.isInteger(prNumber) || prNumber <= 0) {
    process.stderr.write(
      "Usage: node tools/gh/merge-when-green.mjs <pr#> [--timeout <sec>] [--interval <sec>] [--reg-timeout <sec>]\n",
    );
    process.exit(3);
  }
  const extraArgs = args.slice(1);

  // Refuse from a worktree cwd BEFORE spawning the gate — a merge runs from the
  // MAIN tree (`--delete-branch` cannot delete a branch a worktree holds). The
  // gate enforces this too, but refusing here avoids spawning it at all.
  const cwd = process.cwd();
  if (isWorktreeCwd(cwd)) die(cwdGuardMessage(cwd), 4);

  mergeWhenGreen(prNumber, extraArgs);
}

// Run main only when invoked directly, so the pure seams are importable in the
// guard-test harness without firing subprocesses (mirrors merge-gate.mjs).
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main();
}

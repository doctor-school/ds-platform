#!/usr/bin/env node
// DS Platform — one-shot local pre-flight of the PR-event-gated lint guards.
//
// Why: `registry-research`, `spec-link`, `prior-decisions`, and
// `spec-status-fresh` are hard-gated to `GITHUB_EVENT_NAME=pull_request` + a PR
// number (e.g. registry-research-lint.ts:143), so they CANNOT run pre-push — a
// missing PR-body marker (the `registry-research:` line a UI-touching PR needs,
// a `Closes #N` link, a milestone) surfaces only as a CI red + rerun AFTER push,
// an avoidable round-trip (#402 lost a cycle to exactly this). The interim fix
// was a convention rule: run each guard by hand with the right env incantation.
// This is the deterministic version — one command runs all four against a live
// PR so the marker is fixed in the same beat, right after `gh pr create` and
// BEFORE dispatching the Mode (a) review.
//
// Canon: AGENTS.md §4 / `.claude/rules/repo-conventions.md` → "PR-event-gated
// guards run only after push — pre-flight them locally"; ADR-0007 §2.6 (guard
// table). Issue #406.
//
// Usage:
//   node tools/lint/pr-preflight.mjs <N>
//   pnpm pr:preflight <N>                 # alias
//
// What it does, in order:
//   1. parse the PR number from argv (refuse early on a missing/non-numeric arg),
//   2. for each of the four guards, spawn it with `GITHUB_EVENT_NAME=pull_request
//      PR_NUMBER=<N>` layered over the env (so its `gh pr view <N>` reads the LIVE
//      PR body/files via the developer's authenticated gh CLI),
//   3. print a per-guard PASS/FAIL summary,
//   4. exit non-zero if ANY guard failed.
//
// Note: all four are REAL WARN v1 guards (#438 implemented `prior-decisions` and
// `spec-status-fresh`, the last two former exit-0 stubs) — each fails on its
// finding, so pre-flight catches a missing PR-body marker / spec link / Prior-
// decisions section / Draft spec status before push, not as a CI red + rerun.
//
// Exit codes: 0 = all guards passed; 1 = at least one guard failed; 2 = usage
// error.

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── pure seams (unit-tested in guard-tests) ─────────────────────────────────

/**
 * The PR-event-gated guards, in the order CI defines them. `name` is the CI job
 * name (what a reviewer sees in Checks); `file` is the tools/lint entrypoint.
 */
export const GUARDS = [
  { name: "registry-research", file: "registry-research-lint.ts" },
  { name: "spec-link", file: "spec-link-lint.ts" },
  { name: "prior-decisions", file: "prior-decisions-lint.ts" },
  { name: "spec-status-fresh", file: "spec-status-lint.ts" },
];

/**
 * Read the PR number from raw argv (`process.argv.slice(2)`): the first
 * positional (non-`--flag`) arg, if it is all digits. Returns the string number
 * or null when missing / non-numeric.
 */
export function parsePrNumber(argv) {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const n = positional[0];
  if (!n || !/^\d+$/.test(n)) return null;
  return n;
}

/**
 * Fold per-guard results into an overall verdict + printable report lines.
 * @param {{name: string, status: number}[]} results
 * @returns {{ok: boolean, lines: string[]}} `ok` iff every guard exited 0.
 */
export function summarize(results) {
  const lines = results.map(
    (r) => `  ${r.status === 0 ? "PASS" : "FAIL"}  ${r.name}`,
  );
  const ok = results.every((r) => r.status === 0);
  return { ok, lines };
}

// ── impure CLI (skipped on import) ──────────────────────────────────────────

const TAG = "[pr:preflight]";

function out(msg) {
  process.stdout.write(`${TAG} ${msg}\n`);
}
function die(msg, code = 2) {
  process.stderr.write(`${TAG} ${msg}\n`);
  process.exit(code);
}

/** The repo root, derived from this file's location (tools/lint). */
function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/**
 * Run one guard against the live PR, inheriting stdio so its own findings stream
 * through. Invoked via `pnpm exec tsx` (matching the guard-test harness) so the
 * same resolution path runs on the Windows dev box and the ubuntu CI runner.
 */
function runGuard(guard, prNumber, root) {
  out(`── ${guard.name} ──`);
  const res = spawnSync(
    "pnpm",
    ["exec", "tsx", resolve(root, "tools", "lint", guard.file)],
    {
      cwd: root,
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: "pull_request",
        PR_NUMBER: prNumber,
      },
      stdio: "inherit",
      encoding: "utf8",
      shell: process.platform === "win32",
    },
  );
  return { name: guard.name, status: res.status ?? -1 };
}

function main() {
  const prNumber = parsePrNumber(process.argv.slice(2));
  if (!prNumber) {
    die("Usage: pnpm pr:preflight <N>   (N = the live PR number)");
  }

  const root = repoRoot();
  out(`pre-flighting PR #${prNumber} against ${GUARDS.length} PR-event-gated guard(s)…`);

  const results = GUARDS.map((g) => runGuard(g, prNumber, root));

  const { ok, lines } = summarize(results);
  out("summary:");
  for (const line of lines) process.stdout.write(`${line}\n`);

  if (!ok) {
    die(
      "one or more guards failed — fix the PR body/links above, then re-run `pnpm pr:preflight " +
        `${prNumber}\` before dispatching the Mode (a) review.`,
      1,
    );
  }
  out(`all ${GUARDS.length} guards passed — clear to dispatch Mode (a).`);
  process.exit(0);
}

// Run only as the entry point — guarding this keeps the pure seams importable
// from the guard-test harness without firing `main()` / its subprocesses
// (mirrors task-worktree.mjs's INVOKED guard).
const INVOKED = process.argv[1] ? resolve(process.argv[1]) : "";
const SELF = resolve(fileURLToPath(import.meta.url));
if (INVOKED === SELF) {
  main();
}

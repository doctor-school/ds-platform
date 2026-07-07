#!/usr/bin/env node
// DS Platform — one-shot local pre-flight of the CI lint guards, so a defect fails
// at the developer's keyboard instead of as a CI red + rerun.
//
// Two guard families, selected by the CLI:
//
//   1. The PR-EVENT-GATED family (`GUARDS`) — `registry-research`, `spec-link`,
//      `prior-decisions`, `spec-status-fresh`. These are hard-gated to
//      `GITHUB_EVENT_NAME=pull_request` + a PR number (e.g.
//      registry-research-lint.ts:143), so they CANNOT run pre-push — a missing
//      PR-body marker (the `registry-research:` line a UI-touching PR needs, a
//      `Closes #N` link, a milestone) surfaces only as a CI red + rerun AFTER push
//      (#402 lost a cycle to exactly this). Run right after `gh pr create`, BEFORE
//      dispatching the Mode (a) review, against the LIVE PR (each guard's
//      `gh pr view <N>` reads the real PR via the developer's authenticated gh CLI).
//
//   2. The STATIC tree-scan family (`STATIC_GUARDS`, opt-in via `--static`) — the
//      cheap `tools/lint/*.ts` guards that need NO PR context, NO playwright/e2e,
//      and NO Nest boot. PR #452 opened with the sibling `ears-naming` static guard
//      red (non-canonical EARS headings the same PR added) — a CI-red rework loop a
//      local static run would have caught pre-push. A `tools/lint`-touching branch
//      runs `pnpm pr:preflight --static` before `gh pr create` (Issue #462;
//      memory `feedback_orchestration_brief_full_lint_before_pr`). Excluded from
//      this family: the four PR-gated guards above (they run in the base sweep),
//      `endpoint-authz` (boots a Nest context), and `tdd-signal` (also PR-gated).
//
// ── CLI contract ──────────────────────────────────────────────────────────────
//   pnpm pr:preflight <N>            # PR-gated family only, against live PR #N
//   pnpm pr:preflight --static       # static family only (standalone, pre-push)
//   pnpm pr:preflight --static <N>   # BOTH: PR-gated (vs #N) + static family
//   pnpm pr:preflight                # usage error (need a PR number or --static)
//
// Canon: AGENTS.md §4 / `.claude/rules/repo-conventions.md` → "PR-event-gated
// guards run only after push — pre-flight them locally"; ADR-0007 §2.6 (guard
// table). Issues #406, #462.
//
// Exit codes: 0 = all selected guards passed; 1 = at least one failed; 2 = usage
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
 * The cheap STATIC tree-scan guards — every `tools/lint/*.ts` guard that needs no
 * PR context, no playwright/e2e, and no Nest boot — in CI-job order. Run by
 * `--static` for a full local sweep before `gh pr create`. `name` = CI job name,
 * `file` = tools/lint entrypoint. Deliberately EXCLUDES: the four PR-gated guards
 * in `GUARDS` + `tdd-signal` (PR-event-gated, need `gh pr view`) and
 * `endpoint-authz` (boots a Nest application context).
 *
 * `frontmatter-yaml` (#597) is the one entry with NO dedicated CI job: the
 * `docs-build` job already fails hard-red in CI on a malformed frontmatter YAML
 * block (fumadocs compile), so this guard is the LOCAL pre-push mirror of that
 * existing gate — its `name` labels the local run, not a CI job.
 */
export const STATIC_GUARDS = [
  { name: "frontmatter-yaml", file: "frontmatter-yaml-lint.ts" },
  { name: "events-drift", file: "events-lint.ts" },
  { name: "module-readme", file: "module-readme-lint.ts" },
  { name: "glossary-mdx", file: "glossary-mdx-lint.ts" },
  { name: "glossary-roundtrip", file: "glossary-roundtrip-lint.ts" },
  { name: "instruction-budget", file: "instruction-budget-lint.ts" },
  { name: "no-stub", file: "no-stub-lint.ts" },
  { name: "showcase-coverage", file: "showcase-coverage-lint.ts" },
  { name: "showcase-snippet", file: "showcase-snippet-lint.ts" },
  { name: "asset-format", file: "asset-format-lint.ts" },
  { name: "interaction-states", file: "interaction-states-lint.ts" },
  { name: "aa-contrast", file: "aa-contrast-lint.ts" },
  { name: "form-error", file: "form-error-lint.ts" },
  { name: "form-rhythm", file: "form-rhythm-lint.ts" },
  { name: "submit-pending", file: "submit-pending-lint.ts" },
  { name: "ears-tests", file: "ears-test-lint.ts" },
  { name: "ears-naming", file: "ears-naming-lint.ts" },
  { name: "workflow-auth", file: "workflow-auth-lint.ts" },
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

/** True when the `--static` flag is present (opt-in to the static guard family). */
export function hasStaticFlag(argv) {
  return argv.includes("--static");
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
 * Spawn one guard, inheriting stdio so its own findings stream through. Invoked
 * via `pnpm exec tsx` (matching the guard-test harness) so the same resolution
 * path runs on the Windows dev box and the ubuntu CI runner. `extraEnv` layers the
 * `pull_request` Actions context for the PR-gated family; the static family passes
 * `{}` (no PR context needed).
 */
function runGuard(guard, root, extraEnv) {
  out(`── ${guard.name} ──`);
  const res = spawnSync(
    "pnpm",
    ["exec", "tsx", resolve(root, "tools", "lint", guard.file)],
    {
      cwd: root,
      env: { ...process.env, ...extraEnv },
      stdio: "inherit",
      encoding: "utf8",
      shell: process.platform === "win32",
    },
  );
  return { name: guard.name, status: res.status ?? -1 };
}

function main() {
  const argv = process.argv.slice(2);
  const prNumber = parsePrNumber(argv);
  const runStatic = hasStaticFlag(argv);

  if (!prNumber && !runStatic) {
    die(
      "Usage:\n" +
        "  pnpm pr:preflight <N>           PR-event-gated guards vs live PR #N\n" +
        "  pnpm pr:preflight --static      static tree-scan guards (pre-push)\n" +
        "  pnpm pr:preflight --static <N>  both families in one sweep",
    );
  }

  const root = repoRoot();
  const results = [];

  if (prNumber) {
    out(
      `pre-flighting PR #${prNumber} against ${GUARDS.length} PR-event-gated guard(s)…`,
    );
    const prEnv = { GITHUB_EVENT_NAME: "pull_request", PR_NUMBER: prNumber };
    for (const g of GUARDS) results.push(runGuard(g, root, prEnv));
  }

  if (runStatic) {
    out(`running ${STATIC_GUARDS.length} static tree-scan guard(s)…`);
    for (const g of STATIC_GUARDS) results.push(runGuard(g, root, {}));
  }

  const { ok, lines } = summarize(results);
  out("summary:");
  for (const line of lines) process.stdout.write(`${line}\n`);

  if (!ok) {
    die(
      `one or more guards failed — fix the finding(s) above, then re-run \`pnpm pr:preflight${
        runStatic ? " --static" : ""
      }${prNumber ? ` ${prNumber}` : ""}\` before ${
        prNumber ? "dispatching the Mode (a) review" : "`gh pr create`"
      }.`,
      1,
    );
  }
  out(`all ${results.length} guard(s) passed — clear to proceed.`);
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

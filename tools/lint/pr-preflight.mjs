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
//   2. The STATIC tree-scan family (`STATIC_GUARDS`) — the cheap `tools/lint/*.ts`
//      guards that need NO PR context, NO playwright/e2e, and NO Nest boot. In
//      PR-number mode this family runs BY DEFAULT (#633), merged into the same
//      summary + non-zero exit as the PR-gated family, so a static-guard violation
//      (e.g. a non-canonical `ears-naming` heading, as in PR #452 / PR #632) fails
//      at the post-PR preflight every author already runs — not later, in CI or a
//      Mode-a review. `--no-static` opts out for the rare case it must be skipped;
//      standalone (no PR number) it runs only via `--static`. Excluded from this
//      family: the four PR-gated guards above (they run in the base sweep),
//      `endpoint-authz` (boots a Nest context), and `tdd-signal` (also PR-gated).
//
// ── CLI contract ──────────────────────────────────────────────────────────────
//   pnpm pr:preflight <N>              # PR-gated (vs live PR #N) + static family (DEFAULT)
//   pnpm pr:preflight <N> --no-static  # PR-gated only (opt out of the static family)
//   pnpm pr:preflight --static         # static family only (standalone, pre-push)
//   pnpm pr:preflight --static <N>     # both families (same as `<N>`)
//   pnpm pr:preflight                  # usage error (need a PR number or --static)
//
// Canon: AGENTS.md §4 / `.claude/rules/repo-conventions.md` → "PR-event-gated
// guards run only after push — pre-flight them locally"; ADR-0007 §2.6 (guard
// table). Issues #406, #462, #633.
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
  { name: "product-note", file: "product-note-lint.ts" },
];

/**
 * The cheap STATIC tree-scan guards — every `tools/lint/*.ts` guard that needs no
 * PR context, no playwright/e2e, and no Nest boot — in CI-job order. Run by
 * default in PR-number mode (#633; opt-out `--no-static`) and via standalone
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
/**
 * The PRE-MERGE gate family — guards whose evidence exists only at MERGE time,
 * not at PR-create time, so they must NOT run in the default post-create
 * preflight (they would false-fail). Selected by `--pre-merge` (alias
 * `--stage-b`) in PR-number mode and run as a HARD gate, contributing to the
 * non-zero exit. The merge procedure (`merge-when-green`) runs
 * `pnpm pr:preflight <N> --pre-merge` right before `gh pr merge`.
 *
 * `stage-b` (#692): a user-facing PR must carry a recorded product-owner Stage-B
 * GO (AGENTS.md §6) — a Stage-B verdict is only recorded after the owner's live
 * approval, which happens just before merge, so at create time there is nothing
 * to check yet.
 */
export const MERGE_GUARDS = [{ name: "stage-b", file: "stage-b-lint.ts" }];

/**
 * The deterministic CI merge gate (#836) — `tools/gh/merge-gate.mjs`, run last
 * in `--pre-merge` mode (after the cheap stage-b guard): resolves the PR head
 * SHA, requires >0 registered check-runs for THAT SHA with every non-skipped
 * run terminal-successful (zero runs = fresh-push race = FAIL), and refuses to
 * run from a worktree cwd / while the PR branch is held by a registered
 * worktree. A plain `node` script (polls `gh`), not a tools/lint tsx guard —
 * hence the dedicated runner instead of a MERGE_GUARDS entry.
 */
export const MERGE_GATE = {
  name: "merge-gate",
  script: ["tools", "gh", "merge-gate.mjs"],
};

export const STATIC_GUARDS = [
  { name: "frontmatter-yaml", file: "frontmatter-yaml-lint.ts" },
  { name: "events-drift", file: "events-lint.ts" },
  { name: "module-readme", file: "module-readme-lint.ts" },
  { name: "glossary-mdx", file: "glossary-mdx-lint.ts" },
  { name: "glossary-roundtrip", file: "glossary-roundtrip-lint.ts" },
  { name: "instruction-budget", file: "instruction-budget-lint.ts" },
  { name: "migration-index", file: "migration-index-lint.ts" },
  { name: "no-stub", file: "no-stub-lint.ts" },
  { name: "prod-surface", file: "prod-surface-lint.ts" },
  { name: "showcase-coverage", file: "showcase-coverage-lint.ts" },
  { name: "showcase-snippet", file: "showcase-snippet-lint.ts" },
  { name: "asset-format", file: "asset-format-lint.ts" },
  { name: "interaction-states", file: "interaction-states-lint.ts" },
  { name: "primitives-first", file: "primitives-first-lint.ts" },
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

/** True when the `--static` flag is present (force the static guard family). */
export function hasStaticFlag(argv) {
  return argv.includes("--static");
}

/**
 * True when the `--no-static` opt-out flag is present. In PR-number mode the
 * static family runs by default (#633); `--no-static` is the escape hatch for the
 * rare case it must be skipped.
 */
export function hasNoStaticFlag(argv) {
  return argv.includes("--no-static");
}

/**
 * True when the pre-merge gate is requested — `--pre-merge` or its `--stage-b`
 * alias (#692). Runs the MERGE_GUARDS family as a hard gate; only meaningful with
 * a PR number.
 */
export function hasPreMergeFlag(argv) {
  return argv.includes("--pre-merge") || argv.includes("--stage-b");
}

/**
 * Resolve argv into the run plan — which guard families to run and whether the
 * invocation is a usage error. The single pure seam the CLI branches on:
 *
 *   - PR-gated family runs iff a PR number is present.
 *   - Static family runs by DEFAULT in PR-number mode (#633), opt-out via
 *     `--no-static`; standalone it runs only when `--static` is passed. An
 *     explicit `--static` always wins over `--no-static`.
 *   - Usage error when nothing is selected (no PR number and no `--static`).
 *
 *   - Pre-merge gate runs iff `--pre-merge` (or `--stage-b`) is passed WITH a PR
 *     number — it is a merge-time hard gate, never a create-time default.
 *
 * @param {string[]} argv `process.argv.slice(2)`
 * @returns {{prNumber: string|null, runPrGated: boolean, runStatic: boolean, runMergeGate: boolean, usageError: boolean}}
 */
export function resolvePlan(argv) {
  const prNumber = parsePrNumber(argv);
  const staticFlag = hasStaticFlag(argv);
  const noStatic = hasNoStaticFlag(argv);
  const preMerge = hasPreMergeFlag(argv);
  const runPrGated = prNumber !== null;
  const runStatic = staticFlag || (runPrGated && !noStatic);
  const runMergeGate = preMerge && runPrGated;
  const usageError = !runPrGated && !staticFlag;
  return { prNumber, runPrGated, runStatic, runMergeGate, usageError };
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
  const { prNumber, runPrGated, runStatic, runMergeGate, usageError } =
    resolvePlan(argv);

  if (usageError) {
    die(
      "Usage:\n" +
        "  pnpm pr:preflight <N>              PR-event-gated guards vs live PR #N + static family (default)\n" +
        "  pnpm pr:preflight <N> --no-static  PR-event-gated guards only (skip the static family)\n" +
        "  pnpm pr:preflight <N> --pre-merge  add the pre-merge gates: stage-b + the deterministic CI merge gate (#836; run right before `gh pr merge`)\n" +
        "  pnpm pr:preflight --static         static tree-scan guards only (pre-push, no PR number)\n" +
        "  pnpm pr:preflight --static <N>     both families in one sweep (same as `<N>`)",
    );
  }

  const root = repoRoot();
  const results = [];
  const prEnv = { GITHUB_EVENT_NAME: "pull_request", PR_NUMBER: prNumber };

  if (runPrGated) {
    out(
      `pre-flighting PR #${prNumber} against ${GUARDS.length} PR-event-gated guard(s)…`,
    );
    for (const g of GUARDS) results.push(runGuard(g, root, prEnv));
  }

  if (runStatic) {
    out(`running ${STATIC_GUARDS.length} static tree-scan guard(s)…`);
    for (const g of STATIC_GUARDS) results.push(runGuard(g, root, {}));
  }

  if (runMergeGate) {
    out(
      `running ${MERGE_GUARDS.length} pre-merge gate guard(s) (Stage-B) vs live PR #${prNumber}…`,
    );
    for (const g of MERGE_GUARDS) results.push(runGuard(g, root, prEnv));

    // Deterministic CI merge gate (#836): checks-registered + terminal-success
    // for the exact head SHA, plus the worktree-cwd guard. Runs last — it may
    // poll while CI finishes, so the cheap guards fail fast first.
    out(`── ${MERGE_GATE.name} ──`);
    const res = spawnSync(
      "node",
      [resolve(root, ...MERGE_GATE.script), prNumber],
      {
        cwd: root,
        env: process.env,
        stdio: "inherit",
        encoding: "utf8",
        shell: process.platform === "win32",
      },
    );
    results.push({ name: MERGE_GATE.name, status: res.status ?? -1 });
  }

  const { ok, lines } = summarize(results);
  out("summary:");
  for (const line of lines) process.stdout.write(`${line}\n`);

  if (!ok) {
    // Re-run hint mirrors the invocation: PR-number mode runs the static family
    // by default (#633), so no `--static` is appended there.
    const rerun = runPrGated
      ? `pnpm pr:preflight ${prNumber}`
      : "pnpm pr:preflight --static";
    die(
      `one or more guards failed — fix the finding(s) above, then re-run \`${rerun}\` before ${
        runPrGated ? "dispatching the Mode (a) review" : "`gh pr create`"
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

#!/usr/bin/env tsx
/**
 * tools/lint/tdd-signal-lint.ts — WARN v1 for the ADR-0007 design §5.2 "TDD
 * signal" row ("implementation-only commit without a test file. Heuristic; false
 * positives possible").
 *
 * Was a `[stub]` exit-0 (never failed → vacuous green history, not promotable).
 * Implemented per Issue #438. Lands as a REAL WARN v1: exits non-zero on
 * findings; the CI job keeps `continue-on-error: true` until its ADR-0007 §2.6
 * promotion window matures.
 *
 * ── The rule (exact) ──────────────────────────────────────────────────────────
 * A PR that changes production source code but ships NO test — and whose changed
 * source lives in a module with no pre-existing test either — is flagged. Per
 * changed production file `F` (see PRODUCTION-file definition below):
 *   PASS if any test file is in the PR diff (`*.test.*` / `*.spec.*` /
 *         `*.e2e-spec.*`), OR
 *   PASS if a test file already exists anywhere under `F`'s top-level module dir
 *         in the checked-out tree (the design's "commit history shows a
 *         test-commit preceding it" — a preceding test-commit means the test
 *         file is present in the tree now; see the substitution note below).
 *   WARN otherwise (production changed, no test anywhere for that module).
 *
 * ── PR-event gating + the git-history substitution ────────────────────────────
 * The design phrases the escape as "commit history shows a test-commit preceding
 * it". The CI checkout is shallow (`actions/checkout` depth 1) with no base ref,
 * so a `git diff base...HEAD` is not available and the per-job checkout is fixed
 * (out of this Issue's scope to change). This guard therefore reads the changed
 * file set from `gh pr view <N> --json files` (same infra as spec-link /
 * registry-research) and substitutes "a covering test exists in the working tree
 * at HEAD" for "a test-commit preceded it in history" — an EQUIVALENT signal (if
 * a test-commit preceded the change, its test file is in the tree now). As a
 * consequence the guard is PR-event-gated: on a non-`pull_request` run (e.g. a
 * push to `main`) it exits 0 — the TDD signal only matters at PR review time.
 *
 * ── Known blind spots (conservative, low-false-positive by design) ────────────
 * - **Coverage depth is not measured.** A pre-existing but shallow/irrelevant
 *   test in the module suppresses the warning — the guard asks "is this module
 *   tested at all?", not "is THIS change tested?".
 * - **Module granularity.** A brand-new production file added into an
 *   already-tested module passes without its own test (folded to the module).
 * - **Cross-module tests don't count.** A test in a sibling module does not cover
 *   a changed file in another module.
 * - **Branch-stack history invisible.** A test added in an earlier, already-merged
 *   PR of the same stack counts (it's in the tree); a test only in an unmerged
 *   sibling branch does not.
 * These are the "false positives possible" the design acknowledges — the guard is
 * a WARN nudge, not a merge-blocker, and stays conservative to keep noise low.
 *
 * Seams: `LINT_GH_FIXTURE_DIR` (gh file list) + `LINT_FIXTURE_ROOT` (working tree
 * for the existing-test scan). Inert in production.
 * Run: `pnpm lint:tdd-signal` (PR_NUMBER from the Actions context). Findings:
 * stderr + exit 1. Clean / skip: stdout + exit 0.
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";

import { ghViewJson } from "./lib/gh";

const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[tdd-signal]";

// A test file (in the diff or in the tree) — colocated Vitest / api e2e shapes.
const TEST_RE = /\.(?:test|spec|e2e-spec)\.[tj]sx?$/;
// Production source under an app's `src/`. Non-source (config/setup/types/
// generated) and test-adjacent trees are excluded so a config-only or test-only
// change never trips the guard.
const PROD_SRC_RE = /^apps\/[^/]+\/src\/.+\.[tj]sx?$/;
const PROD_EXEMPT_RE =
  /(\.d\.ts$|\.(?:test|spec|e2e-spec)\.[tj]sx?$|\.config\.[mc]?[tj]sx?$|\.setup\.[mc]?[tj]sx?$|\.stories\.[tj]sx?$|(^|\/)__tests__\/|(^|\/)e2e\/|(^|\/)__mocks__\/|(^|\/)generated\/)/;

interface GhPR {
  number: number;
  files?: { path: string }[];
}

function fail(msg: string): never {
  process.stderr.write(`${TAG} ${msg}\n`);
  process.exit(1);
}
function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

function resolvePrNumber(): string {
  let prNumber = process.env.PR_NUMBER ?? process.env.GITHUB_PR_NUMBER ?? "";
  if (!prNumber && process.env.GITHUB_REF) {
    const m = process.env.GITHUB_REF.match(/refs\/pull\/(\d+)\//);
    if (m) prNumber = m[1];
  }
  return prNumber;
}

/** Top-level module dir for a source file: `apps/<app>/src/<seg>`. */
function moduleRoot(fileRel: string): string {
  const m = fileRel.match(/^(apps\/[^/]+\/src\/[^/]+)/);
  return m ? m[1] : dirname(fileRel);
}

/** True iff any `*.test/spec/e2e-spec` file exists under `moduleDir` in the tree. */
async function moduleHasTest(moduleDir: string): Promise<boolean> {
  const hits = await fg(`${moduleDir}/**/*.{test,spec,e2e-spec}.{ts,tsx,js,jsx}`, {
    cwd: REPO_ROOT,
    ignore: ["**/node_modules/**"],
  });
  return hits.length > 0;
}

async function main(): Promise<void> {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    info(
      `not a pull_request event (GITHUB_EVENT_NAME=${process.env.GITHUB_EVENT_NAME ?? "unset"}), skipping`,
    );
    process.exit(0);
  }
  const prNumber = resolvePrNumber();
  if (!prNumber) {
    info("cannot determine PR number from environment, skipping");
    process.exit(0);
  }

  const res = await ghViewJson<GhPR>("pr", prNumber, "number,files", REPO_ROOT);
  if (!res.ok) fail(`could not fetch PR #${prNumber} metadata: ${res.error}`);
  const pr = res.data;

  const files = (pr.files ?? []).map((f) => f.path.replace(/\\/g, "/"));
  const diffHasTest = files.some((p) => TEST_RE.test(p));
  const prodFiles = files.filter(
    (p) => PROD_SRC_RE.test(p) && !PROD_EXEMPT_RE.test(p),
  );

  if (prodFiles.length === 0) {
    info(
      `PR #${pr.number} changes no production source under apps/*/src, rule does not apply`,
    );
    process.exit(0);
  }
  info(
    `PR #${pr.number} changes ${prodFiles.length} production source file(s); diff ${diffHasTest ? "INCLUDES" : "includes NO"} test file(s)`,
  );

  if (diffHasTest) {
    info(`PASS — the changeset ships a test alongside the production change.`);
    process.exit(0);
  }

  // No test in the diff: a changed file is fine only if its module is already
  // tested in the tree (a test-commit preceded it). Flag modules with no test.
  const uncovered: string[] = [];
  const checked = new Map<string, boolean>();
  for (const f of prodFiles) {
    const mod = moduleRoot(f);
    if (!checked.has(mod)) checked.set(mod, await moduleHasTest(mod));
    if (!checked.get(mod)) uncovered.push(f);
  }

  if (uncovered.length === 0) {
    info(
      `PASS — no test in the diff, but every changed module already carries tests (refactor of tested code).`,
    );
    process.exit(0);
  }

  for (const f of uncovered) {
    process.stderr.write(`${TAG} untested change  ${f}  (module \`${moduleRoot(f)}\` has no test)\n`);
  }
  fail(
    `${uncovered.length} production source file(s) changed with no test in the diff and no existing test in their module. ` +
      `Per AGENTS.md §6 (TDD) add a failing \`it('EARS-N: …')\` test with the change. ` +
      `Heuristic (design §5.2); if this is a genuine test-exempt change (pure types, config), the WARN can be ignored — the CI job is \`continue-on-error\`.`,
  );
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});

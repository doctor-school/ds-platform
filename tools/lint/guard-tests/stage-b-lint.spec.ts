import { describe, expect, it } from "vitest";

import { caseDir, ghDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/stage-b-lint.ts` (#692).
 *
 * The Stage-B merge guard blocks a user-facing PR from merging without a
 * recorded product-owner Stage-B GO (AGENTS.md §6). Like registry-research /
 * spec-link it reaches GitHub through `gh pr view` / `gh issue view`, stubbed
 * here via the `LINT_GH_FIXTURE_DIR` seam (lib/gh.ts): each case ships a canned
 * `gh/pr-view-<n>.json` (and, when the marker lives on a linked Issue,
 * `gh/issue-view-<n>.json`), and the run sets the Actions context
 * (`GITHUB_EVENT_NAME`, `PR_NUMBER`) so the guard's real env-resolution +
 * surface detection + marker-evidence logic all run.
 *
 * The frontmatter-heuristic cases (`*-ds-*`) additionally ship a spec tree under
 * the case dir (served through `LINT_FIXTURE_ROOT`) so the guard's
 * label→spec-folder→`surface:` resolution runs against a fixture requirements
 * file rather than the real repo.
 *
 * `red-no-marker` is the regression pin for the #691 miss: a portal render PR
 * with no Stage-B record must fail.
 */
const GUARD = "stage-b-lint.ts";

/** Standard pull_request context pointing the gh seam at a case's canned JSON. */
function prEnv(prNumber: string, ghCase: string): Record<string, string> {
  return {
    GITHUB_EVENT_NAME: "pull_request",
    PR_NUMBER: prNumber,
    LINT_GH_FIXTURE_DIR: ghDir("stage-b", ghCase),
  };
}

describe("stage-b-lint", () => {
  it("green: portal render + `Stage-B: GO` in body → exit 0", () => {
    const { code } = runGuard(GUARD, caseDir("stage-b", "green-body-go"), {
      env: prEnv("200", "green-body-go"),
    });
    expect(code).toBe(0);
  });

  it("green: admin render + `Stage-B: batched at #700` (batched-gate carve-out) → exit 0", () => {
    const { code } = runGuard(GUARD, caseDir("stage-b", "green-body-batched"), {
      env: prEnv("201", "green-body-batched"),
    });
    expect(code).toBe(0);
  });

  it("green (#699): portal render + lead-certification token (em-dash `— lead-certified`) → exit 0", () => {
    const { code } = runGuard(
      GUARD,
      caseDir("stage-b", "green-body-lead-certified"),
      { env: prEnv("211", "green-body-lead-certified") },
    );
    expect(code).toBe(0);
  });

  it("green (#699): admin render + lead-certification token (ASCII hyphen `- lead-certified`) → exit 0", () => {
    const { code } = runGuard(
      GUARD,
      caseDir("stage-b", "green-body-lead-certified-ascii"),
      { env: prEnv("212", "green-body-lead-certified-ascii") },
    );
    expect(code).toBe(0);
  });

  it("green: portal render, no body marker but a linked-Issue comment carries GO → exit 0", () => {
    const { code } = runGuard(GUARD, caseDir("stage-b", "green-comment-go"), {
      env: prEnv("202", "green-comment-go"),
    });
    expect(code).toBe(0);
  });

  it("red (#691 regression): portal render + no Stage-B marker anywhere → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      caseDir("stage-b", "red-no-marker"),
      { env: prEnv("203", "red-no-marker") },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("Stage-B");
  });

  it("red: portal render + a placeholder marker (`Stage-B: TBD`) → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      caseDir("stage-b", "red-empty-marker"),
      { env: prEnv("204", "red-empty-marker") },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("not a Stage-B");
  });

  it("skip: backend-only PR (apps/api) → exit 0", () => {
    const { code, stdout } = runGuard(
      GUARD,
      caseDir("stage-b", "skip-backend-only"),
      { env: prEnv("205", "skip-backend-only") },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("rule does not apply");
  });

  it("skip: docs-only PR → exit 0", () => {
    const { code, stdout } = runGuard(
      GUARD,
      caseDir("stage-b", "skip-docs-only"),
      { env: prEnv("206", "skip-docs-only") },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("rule does not apply");
  });

  it("skip: test-only change under a UI surface (spec/e2e exempt) → exit 0", () => {
    const { code, stdout } = runGuard(
      GUARD,
      caseDir("stage-b", "skip-test-only"),
      { env: prEnv("207", "skip-test-only") },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("rule does not apply");
  });

  it("green (frontmatter heuristic): design-system render + user-facing spec + GO → exit 0", () => {
    const { code } = runGuard(
      GUARD,
      caseDir("stage-b", "green-ds-userfacing-spec"),
      { env: prEnv("208", "green-ds-userfacing-spec") },
    );
    expect(code).toBe(0);
  });

  it("red (frontmatter heuristic): design-system render + user-facing spec + no marker → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      caseDir("stage-b", "red-ds-userfacing-no-marker"),
      { env: prEnv("209", "red-ds-userfacing-no-marker") },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("Stage-B");
  });

  it("skip (frontmatter heuristic): design-system-only under a backend-only spec → exit 0", () => {
    const { code, stdout } = runGuard(
      GUARD,
      caseDir("stage-b", "skip-ds-nonuserfacing-spec"),
      { env: prEnv("210", "skip-ds-nonuserfacing-spec") },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("rule does not apply");
  });

  it("skip: not a pull_request event → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, caseDir("stage-b", "green-body-go"), {
      env: {
        GITHUB_EVENT_NAME: "push",
        LINT_GH_FIXTURE_DIR: ghDir("stage-b", "green-body-go"),
      },
    });
    expect(code).toBe(0);
    expect(stdout).toContain("skipping");
  });
});

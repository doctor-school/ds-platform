import { describe, expect, it } from "vitest";

import { caseDir, ghDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/spec-status-lint.ts` (#438). PR-event-gated:
 * `gh pr view` (number,labels,files) is stubbed via `LINT_GH_FIXTURE_DIR` and the
 * spec frontmatter is read from the fixture tree via `LINT_FIXTURE_ROOT`.
 */
const GUARD = "spec-status-lint.ts";
function prEnv(prNumber: string, ghCase: string): Record<string, string> {
  return {
    GITHUB_EVENT_NAME: "pull_request",
    PR_NUMBER: prNumber,
    LINT_GH_FIXTURE_DIR: ghDir("spec-status", ghCase),
  };
}

describe("spec-status-lint", () => {
  it("green: feature PR, spec status `In dev` → exit 0", () => {
    const { code } = runGuard(GUARD, caseDir("spec-status", "green-in-dev"), {
      env: prEnv("600", "green-in-dev"),
    });
    expect(code).toBe(0);
  });

  it("red: feature PR implements a spec still at `Draft` → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, caseDir("spec-status", "red-draft"), {
      env: prEnv("601", "red-draft"),
    });
    expect(code).toBe(1);
    expect(stderr).toContain("Draft");
  });

  it("skip: the authoring PR edits the requirements file itself → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, caseDir("spec-status", "skip-authoring"), {
      env: prEnv("602", "skip-authoring"),
    });
    expect(code).toBe(0);
    expect(stdout).toContain("authoring/status-bump PR");
  });

  it("skip: PR carries no feature:NNN-<slug> label → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, caseDir("spec-status", "skip-no-label"), {
      env: prEnv("603", "skip-no-label"),
    });
    expect(code).toBe(0);
    expect(stdout).toContain("no feature:NNN-<slug> label");
  });
});

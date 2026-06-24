import { describe, expect, it } from "vitest";

import { caseDir, ghDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/spec-link-lint.ts` (#293) — a BLOCK guard.
 *
 * spec-link needs BOTH seams: `gh pr/issue view` is stubbed via
 * `LINT_GH_FIXTURE_DIR` (lib/gh.ts), and the spec-folder existence checks read
 * the repo FS via `LINT_FIXTURE_ROOT` (set to the case dir by runGuard). Each
 * case ships canned `gh/pr-view-<n>.json` + `gh/issue-view-<n>.json` and, where
 * relevant, an `apps/docs/content/specs/features/<slug>/` tree so the guard's
 * real label-parse → milestone → spec-folder → requirements-file logic runs.
 *
 * The red cases isolate ONE failure each (the other inputs are kept valid) so the
 * asserted stderr substring maps to a single branch.
 */
const GUARD = "spec-link-lint.ts";

/** pull_request context pointing the gh seam at a case's canned JSON. */
function prEnv(prNumber: string, ghCase: string): Record<string, string> {
  return {
    GITHUB_EVENT_NAME: "pull_request",
    PR_NUMBER: prNumber,
    LINT_GH_FIXTURE_DIR: ghDir("spec-link", ghCase),
  };
}

describe("spec-link-lint", () => {
  it("green: feature label + Closes #N + milestone + spec folder w/ requirements → exit 0", () => {
    const { code } = runGuard(GUARD, caseDir("spec-link", "green"), {
      env: prEnv("200", "green"),
    });
    expect(code).toBe(0);
  });

  it("red: a linked Issue carries no milestone → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      caseDir("spec-link", "red-no-milestone"),
      { env: prEnv("201", "red-no-milestone") },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("no milestone");
  });

  it("red: the feature label references a non-existent spec folder → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      caseDir("spec-link", "red-missing-spec-folder"),
      { env: prEnv("202", "red-missing-spec-folder") },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("does not exist");
  });

  it("red: spec folder exists but lacks a requirements file → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      caseDir("spec-link", "red-missing-requirements"),
      { env: prEnv("203", "red-missing-requirements") },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("requirements");
  });

  it("skip: PR has no feature:* label → exit 0", () => {
    const { code, stdout } = runGuard(
      GUARD,
      caseDir("spec-link", "skip-no-feature-label"),
      { env: prEnv("204", "skip-no-feature-label") },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("no feature:* label");
  });
});

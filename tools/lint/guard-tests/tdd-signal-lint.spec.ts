import { describe, expect, it } from "vitest";

import { caseDir, ghDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/tdd-signal-lint.ts` (#438). PR-event-gated:
 * the changed-file list is stubbed via `LINT_GH_FIXTURE_DIR` (lib/gh.ts) and the
 * existing-test scan reads the working tree via `LINT_FIXTURE_ROOT` (the case
 * dir). Each case ships `gh/pr-view-<n>.json`; the green-existing-test and
 * red-no-test cases also ship a tree so the "module already tested?" branch runs.
 */
const GUARD = "tdd-signal-lint.ts";
function prEnv(prNumber: string, ghCase: string): Record<string, string> {
  return {
    GITHUB_EVENT_NAME: "pull_request",
    PR_NUMBER: prNumber,
    LINT_GH_FIXTURE_DIR: ghDir("tdd-signal", ghCase),
  };
}

describe("tdd-signal-lint", () => {
  it("green: the diff ships a test alongside the production change → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, caseDir("tdd-signal", "green-test-in-diff"), {
      env: prEnv("500", "green-test-in-diff"),
    });
    expect(code).toBe(0);
    expect(stdout).toContain("ships a test");
  });

  it("green: no test in the diff but the module is already tested in the tree → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, caseDir("tdd-signal", "green-existing-test"), {
      env: prEnv("501", "green-existing-test"),
    });
    expect(code).toBe(0);
    expect(stdout).toContain("already carries tests");
  });

  it("red: production changed, no test in the diff and none in the module → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, caseDir("tdd-signal", "red-no-test"), {
      env: prEnv("502", "red-no-test"),
    });
    expect(code).toBe(1);
    expect(stderr).toContain("untested change");
  });

  it("skip: PR changes no production source → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, caseDir("tdd-signal", "skip-no-source"), {
      env: prEnv("503", "skip-no-source"),
    });
    expect(code).toBe(0);
    expect(stdout).toContain("no production source");
  });

  it("skip: not a pull_request event → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, caseDir("tdd-signal", "skip-no-source"), {
      env: { GITHUB_EVENT_NAME: "push" },
    });
    expect(code).toBe(0);
    expect(stdout).toContain("not a pull_request event");
  });
});

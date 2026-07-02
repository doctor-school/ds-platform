import { describe, expect, it } from "vitest";

import { caseDir, ghDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/prior-decisions-lint.ts` (#438).
 * PR-event-gated: `gh pr view` (number,files) is stubbed via
 * `LINT_GH_FIXTURE_DIR` and the touched requirements file is read from the
 * fixture tree via `LINT_FIXTURE_ROOT`.
 */
const GUARD = "prior-decisions-lint.ts";
function prEnv(prNumber: string, ghCase: string): Record<string, string> {
  return {
    GITHUB_EVENT_NAME: "pull_request",
    PR_NUMBER: prNumber,
    LINT_GH_FIXTURE_DIR: ghDir("prior-decisions", ghCase),
  };
}

describe("prior-decisions-lint", () => {
  it("green: touched requirements file cites an ADR in Prior decisions → exit 0", () => {
    const { code } = runGuard(GUARD, caseDir("prior-decisions", "green"), {
      env: prEnv("700", "green"),
    });
    expect(code).toBe(0);
  });

  it("red: requirements file has no `## Prior decisions` section → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, caseDir("prior-decisions", "red-no-section"), {
      env: prEnv("701", "red-no-section"),
    });
    expect(code).toBe(1);
    expect(stderr).toContain("no `## Prior decisions` section");
  });

  it("red: Prior decisions section cites no ADR → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, caseDir("prior-decisions", "red-no-adr"), {
      env: prEnv("702", "red-no-adr"),
    });
    expect(code).toBe(1);
    expect(stderr).toContain("cites no ADR");
  });

  it("skip: PR touches no feature-spec requirements file → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, caseDir("prior-decisions", "skip-no-spec"), {
      env: prEnv("703", "skip-no-spec"),
    });
    expect(code).toBe(0);
    expect(stdout).toContain("touches no feature-spec requirements file");
  });
});

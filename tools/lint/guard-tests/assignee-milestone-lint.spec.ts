import { describe, expect, it } from "vitest";

import { ghDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/assignee-milestone-lint.ts` (#1140).
 *
 * Every open-PR board row must carry ≥1 assignee AND a milestone. Like the other
 * PR-event-gated guards it reaches GitHub through `gh pr view`, stubbed here via
 * the `LINT_GH_FIXTURE_DIR` seam (lib/gh.ts): each case ships a canned
 * `gh/pr-view-<n>.json`, and the run sets the Actions context so the guard's real
 * env-resolution + field checks run. HARD FAIL (exit 1) when either field is
 * missing — the fields are trivially settable at create time.
 */
const GUARD = "assignee-milestone-lint.ts";

function prEnv(prNumber: string, ghCase: string): Record<string, string> {
  return {
    GITHUB_EVENT_NAME: "pull_request",
    PR_NUMBER: prNumber,
    LINT_GH_FIXTURE_DIR: ghDir("assignee-milestone", ghCase),
  };
}

describe("assignee-milestone-lint", () => {
  it("green: PR with an assignee AND a milestone → exit 0", () => {
    const { code } = runGuard(GUARD, ".", { env: prEnv("300", "green-both") });
    expect(code).toBe(0);
  });

  it("red: no assignee → exit 1, names the missing field", () => {
    const { code, stderr } = runGuard(GUARD, ".", {
      env: prEnv("301", "red-no-assignee"),
    });
    expect(code).toBe(1);
    expect(stderr).toContain("assignee");
  });

  it("red: no milestone → exit 1, names the missing field", () => {
    const { code, stderr } = runGuard(GUARD, ".", {
      env: prEnv("302", "red-no-milestone"),
    });
    expect(code).toBe(1);
    expect(stderr).toContain("milestone");
  });

  it("red: neither → exit 1, names both", () => {
    const { code, stderr } = runGuard(GUARD, ".", {
      env: prEnv("303", "red-neither"),
    });
    expect(code).toBe(1);
    expect(stderr).toContain("assignee + milestone");
  });

  it("skip: not a pull_request event → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, ".", {
      env: {
        GITHUB_EVENT_NAME: "push",
        LINT_GH_FIXTURE_DIR: ghDir("assignee-milestone", "green-both"),
      },
    });
    expect(code).toBe(0);
    expect(stdout).toContain("skipping");
  });

  it("fail-closed: a gh fetch failure (missing fixture) → exit 1", () => {
    const { code } = runGuard(GUARD, ".", {
      env: prEnv("999", "green-both"),
    });
    expect(code).toBe(1);
  });
});

import { describe, expect, it } from "vitest";

import { caseDir, ghDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/product-note-lint.ts` (Issue #654).
 *
 * The guard reads PR labels + body via `gh pr view`, driven here through the
 * `LINT_GH_FIXTURE_DIR` seam (lib/gh.ts): each case ships a canned
 * `gh/pr-view-<n>.json` and the run sets the Actions context
 * (`GITHUB_EVENT_NAME`, `PR_NUMBER`) so the guard's env-resolution + label
 * classification + note-extraction logic all run.
 */
const GUARD = "product-note-lint.ts";

/** Standard pull_request context pointing the gh seam at a case's canned JSON. */
function prEnv(prNumber: string, ghCase: string): Record<string, string> {
  return {
    GITHUB_EVENT_NAME: "pull_request",
    PR_NUMBER: prNumber,
    LINT_GH_FIXTURE_DIR: ghDir("product-note", ghCase),
  };
}

describe("product-note-lint", () => {
  it("green: feature PR with a real Product note → exit 0", () => {
    const { code } = runGuard(GUARD, caseDir("product-note", "feature-with-note"), {
      env: prEnv("200", "feature-with-note"),
    });
    expect(code).toBe(0);
  });

  it("green: bug PR with a real Product note → exit 0", () => {
    const { code } = runGuard(GUARD, caseDir("product-note", "bug-with-note"), {
      env: prEnv("204", "bug-with-note"),
    });
    expect(code).toBe(0);
  });

  it("red: feature PR with an empty Product note section → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      caseDir("product-note", "feature-no-note"),
      { env: prEnv("201", "feature-no-note") },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("no real `Product note (RU)`");
  });

  it("red: `none` on a feature-labeled PR → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      caseDir("product-note", "feature-none"),
      { env: prEnv("202", "feature-none") },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("user-facing");
  });

  it("green: `none` on an internal-only (chore) PR → exit 0", () => {
    const { code, stdout } = runGuard(
      GUARD,
      caseDir("product-note", "chore-none"),
      { env: prEnv("203", "chore-none") },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("internal-only");
  });

  it("skip: not a pull_request event → exit 0", () => {
    const { code, stdout } = runGuard(
      GUARD,
      caseDir("product-note", "feature-with-note"),
      { env: { GITHUB_EVENT_NAME: "push" } },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("not a pull_request event");
  });
});

import { describe, expect, it } from "vitest";

import { caseDir, ghDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/cross-front-reuse-lint.ts` (#1821).
 *
 * Like its `registry-research` sibling, this guard reaches GitHub through
 * `gh pr view`, which the `LINT_FIXTURE_ROOT` filesystem seam cannot stub. It is
 * driven through the `LINT_GH_FIXTURE_DIR` seam (lib/gh.ts): each case ships a
 * canned `gh/pr-view-<n>.json` and the run sets the Actions context
 * (`GITHUB_EVENT_NAME`, `PR_NUMBER`) so the guard's real env-resolution +
 * storefront-path detection + artifact-evidence logic all run.
 *
 * The rule under test: a PR touching either storefront host tree
 * (`apps/portal/{app,components,lib}/**`, `apps/doctor/{app,components,lib}/**`)
 * must say in its body WHICH canonical unit it consumed — or declare
 * new/bespoke with a rationale. The answer key is
 * `apps/docs/content/specs/product/two-site-ia/capability-ownership.md`.
 */
const GUARD = "cross-front-reuse-lint.ts";

/** Standard pull_request context pointing the gh seam at a case's canned JSON. */
function prEnv(prNumber: string, ghCase: string): Record<string, string> {
  return {
    GITHUB_EVENT_NAME: "pull_request",
    PR_NUMBER: prNumber,
    LINT_GH_FIXTURE_DIR: ghDir("cross-front-reuse", ghCase),
  };
}

describe("cross-front-reuse-lint", () => {
  it("green: storefront host touch + a marker naming the canonical packages/ path → exit 0", () => {
    const { code, stdout } = runGuard(
      GUARD,
      caseDir("cross-front-reuse", "green-canonical"),
      { env: prEnv("200", "green-canonical") },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("artifact OK");
  });

  it("green: the hyphenated `cross-front-reuse:` spelling with a `new — <rationale>` value → exit 0", () => {
    const { code } = runGuard(
      GUARD,
      caseDir("cross-front-reuse", "green-new-rationale"),
      { env: prEnv("201", "green-new-rationale") },
    );
    expect(code).toBe(0);
  });

  it("green: the `## Cross-front reuse` section form is accepted → exit 0", () => {
    const { code } = runGuard(
      GUARD,
      caseDir("cross-front-reuse", "green-section"),
      { env: prEnv("202", "green-section") },
    );
    expect(code).toBe(0);
  });

  it("skip: only tests / e2e support under a storefront tree → exit 0", () => {
    const { code, stdout } = runGuard(
      GUARD,
      caseDir("cross-front-reuse", "green-tests-only"),
      { env: prEnv("203", "green-tests-only") },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("rule does not apply");
  });

  it("red: storefront host touch with no marker → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      caseDir("cross-front-reuse", "red-no-marker"),
      { env: prEnv("204", "red-no-marker") },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("no cross-front reuse artifact");
  });

  it("red: a blank/placeholder marker (`tbd`) → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      caseDir("cross-front-reuse", "red-empty-marker"),
      { env: prEnv("205", "red-empty-marker") },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("not evidence");
  });

  it("red: a bare `new` with no rationale is not evidence → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      caseDir("cross-front-reuse", "red-bare-new"),
      { env: prEnv("206", "red-bare-new") },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("not evidence");
  });

  it("skip: a shared-package / shared-API-only PR touches no host tree → exit 0", () => {
    const { code, stdout } = runGuard(
      GUARD,
      caseDir("cross-front-reuse", "skip-no-host"),
      { env: prEnv("207", "skip-no-host") },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("rule does not apply");
  });

  it("regression (#651): the event-payload PR_BODY overrides a stale fetched body → exit 0", () => {
    // Same fixture as `red-no-marker` (fetched body carries no artifact), but the
    // workflow-injected payload body has a valid marker — the payload must win.
    const { code } = runGuard(
      GUARD,
      caseDir("cross-front-reuse", "red-no-marker"),
      {
        env: {
          ...prEnv("204", "red-no-marker"),
          PR_BODY:
            "## Summary\n\ncross-front reuse: consumes packages/design-system/src/blocks/event-list.tsx as the canonical unit.\n",
        },
      },
    );
    expect(code).toBe(0);
  });

  it("skip: not a pull_request event → exit 0", () => {
    const { code, stdout } = runGuard(
      GUARD,
      caseDir("cross-front-reuse", "green-canonical"),
      { env: { GITHUB_EVENT_NAME: "push" } },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("not a pull_request event");
  });
});

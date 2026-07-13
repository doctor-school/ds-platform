import { describe, expect, it } from "vitest";

import { caseDir, ghDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/registry-research-lint.ts` (#293).
 *
 * This guard reaches GitHub via `gh pr view`, which the `LINT_FIXTURE_ROOT`
 * filesystem seam cannot stub. It is driven here through the `LINT_GH_FIXTURE_DIR`
 * seam (lib/gh.ts): each case ships a canned `gh/pr-view-<n>.json` and the run
 * sets the Actions context (`GITHUB_EVENT_NAME`, `PR_NUMBER`) so the guard's real
 * env-resolution + UI-path detection + artifact-evidence logic all run.
 *
 * `green-config-mjs` is the regression test for the exempt-regex fix: a
 * build-config-only change to `*.config.mjs` under packages/design-system MUST be
 * exempt (no UI source touched) and so pass even with no registry-research
 * artifact. The pre-fix `\.config\.[tjm]s$` failed to match `.mjs`/`.cjs` and
 * would have tripped this case.
 */
const GUARD = "registry-research-lint.ts";

/** Standard pull_request context pointing the gh seam at a case's canned JSON. */
function prEnv(prNumber: string, ghCase: string): Record<string, string> {
  return {
    GITHUB_EVENT_NAME: "pull_request",
    PR_NUMBER: prNumber,
    LINT_GH_FIXTURE_DIR: ghDir("registry-research", ghCase),
  };
}

describe("registry-research-lint", () => {
  it("green: UI touch + a valid `adopted … from shadcn` artifact → exit 0", () => {
    const { code } = runGuard(GUARD, caseDir("registry-research", "green"), {
      env: prEnv("100", "green"),
    });
    expect(code).toBe(0);
  });

  it("red: UI touch with no registry-research marker → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      caseDir("registry-research", "red-no-marker"),
      { env: prEnv("101", "red-no-marker") },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("no registry-research artifact");
  });

  it("red: UI touch with a blank/placeholder marker (`tbd`) → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      caseDir("registry-research", "red-empty-marker"),
      { env: prEnv("102", "red-empty-marker") },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("not evidence");
  });

  it("skip: PR touches no user-facing UI source → exit 0", () => {
    const { code, stdout } = runGuard(
      GUARD,
      caseDir("registry-research", "skip-no-ui"),
      { env: prEnv("103", "skip-no-ui") },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("rule does not apply");
  });

  it("regression (#293): a `*.config.mjs`-only change is exempt → exit 0", () => {
    const { code } = runGuard(
      GUARD,
      caseDir("registry-research", "green-config-mjs"),
      { env: prEnv("104", "green-config-mjs") },
    );
    expect(code).toBe(0);
  });

  it("regression (#309): an `apps/*/e2e/**` support-file-only change is exempt → exit 0", () => {
    const { code } = runGuard(
      GUARD,
      caseDir("registry-research", "green-e2e-support"),
      { env: prEnv("105", "green-e2e-support") },
    );
    expect(code).toBe(0);
  });

  it("regression (#378): a `*.setup.ts`-only change (vitest.setup.ts) is exempt → exit 0", () => {
    const { code } = runGuard(
      GUARD,
      caseDir("registry-research", "green-setup-ts"),
      { env: prEnv("106", "green-setup-ts") },
    );
    expect(code).toBe(0);
  });

  it("regression (#746): an infra-only PR (Dockerfile, compose, env templates, dotfiles) is exempt → exit 0", () => {
    const { code, stdout } = runGuard(
      GUARD,
      caseDir("registry-research", "green-infra-only"),
      { env: prEnv("107", "green-infra-only") },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("rule does not apply");
  });

  it("regression (#746): a Dockerfile touch does NOT exempt the `.tsx` in the same PR → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      caseDir("registry-research", "red-infra-plus-tsx"),
      { env: prEnv("108", "red-infra-plus-tsx") },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("no registry-research artifact");
  });

  it("skip: not a pull_request event → exit 0", () => {
    const { code, stdout } = runGuard(
      GUARD,
      caseDir("registry-research", "green"),
      { env: { GITHUB_EVENT_NAME: "push" } },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("not a pull_request event");
  });
});

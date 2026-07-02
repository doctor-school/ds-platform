import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/workflow-auth-lint.ts` (job `workflow-auth`,
 * #462). `LINT_FIXTURE_ROOT` (set to the case dir by runGuard) points BOTH the
 * `.github/workflows/ci.yml` read AND the gh-consumer derive scan
 * (`tools/lint/*.ts` + `package.json`) at a fixture tree, so the guard's parse +
 * derive + assertion logic runs end-to-end against a fixture workflow instead of
 * the real ci.yml.
 */
const GUARD = "workflow-auth-lint.ts";
const dir = (name: string) => caseDir("workflow-auth", name);

describe("workflow-auth", () => {
  it("green: gh-gated jobs carry permissions + step env; non-gh job ignored → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
    expect(stdout).toContain("PASS");
    // Derives the gh-consumer set by scanning for the `./lib/gh` import, and
    // detects gh-gating via BOTH the direct guard-file path (spec-link) and the
    // `pnpm lint:<name>` alias (registry-research); the static module-readme
    // marker is excluded, and the perms-less `lint` job is not gh-gated.
    expect(stdout).toContain("spec-link-lint.ts");
    expect(stdout).toContain("registry-research-lint.ts");
    expect(stdout).not.toContain("module-readme-lint.ts");
    expect(stdout).toContain("all 2 gh-gated job(s)");
  });

  it("red: a gh-gated job missing the permissions block → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-missing-permissions"));
    expect(code).toBe(1);
    expect(stderr).toContain("missing `permissions.pull-requests: read`");
    expect(stderr).toContain("missing `permissions.contents: read`");
    expect(stderr).toContain("spec-link");
    // scoped per-job: the compliant registry-research sibling is not flagged.
    expect(stderr).not.toContain("registry-research:");
  });

  it("red: a gh-gated step missing GH_TOKEN/PR_NUMBER env → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-missing-env"));
    expect(code).toBe(1);
    expect(stderr).toContain("missing `GH_TOKEN` env");
    expect(stderr).toContain("missing `PR_NUMBER` env");
  });
});

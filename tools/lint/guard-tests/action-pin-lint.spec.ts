import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/action-pin-lint.ts` (guard `action-pin`,
 * #3005). `LINT_FIXTURE_ROOT` points the `.github/workflows/*.yml` and
 * `.github/actions/**\/action.yml` scan at a fixture tree.
 */
const GUARD = "action-pin-lint.ts";
const dir = (name: string) => caseDir("action-pin", name);

describe("action-pin", () => {
  it("green: SHA pins with a version comment, local refs, docker:// refs and reusable workflows → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
    expect(stdout).toContain("PASS");
    // 3 remote refs: checkout + lychee (quoted) in the workflow, setup-node in
    // the composite action; the nested reusable workflow ref is the 4th.
    expect(stdout).toContain("4 remote `uses:` ref(s)");
  });

  it("red: a tag pin → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-tag"));
    expect(code).toBe(1);
    expect(stderr).toContain("ci.yml:7");
    expect(stderr).toContain("actions/checkout@v7");
    expect(stderr).toContain("not a 40-hex commit SHA");
    // the compliant sibling on line 8 is not flagged.
    expect(stderr).not.toContain("ci.yml:8");
  });

  it("red: a short SHA → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-short-sha"));
    expect(code).toBe(1);
    expect(stderr).toContain("actions/checkout@3d3c42e");
    expect(stderr).toContain("not a 40-hex commit SHA");
  });

  it("red: a SHA pin without the trailing `# vX…` comment → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-missing-comment"));
    expect(code).toBe(1);
    expect(stderr).toContain("release.yml:7");
    expect(stderr).toContain("missing the trailing `# vX");
  });

  it("red: a major-only `# v7` comment is not an exact release tag → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-major-only-comment"));
    expect(code).toBe(1);
    expect(stderr).toContain("ci.yml:7");
    expect(stderr).toContain("missing the trailing `# vX");
    // an exact semver tag with a pre-release suffix is accepted.
    expect(stderr).not.toContain("ci.yml:8");
  });

  it("red: a composite action under .github/actions is scanned too → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-composite-action"));
    expect(code).toBe(1);
    expect(stderr).toContain("actions/setup/action.yml:5");
    expect(stderr).toContain("pnpm/action-setup@main");
  });
});

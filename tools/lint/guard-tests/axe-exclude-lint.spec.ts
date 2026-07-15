import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/axe-exclude-lint.ts` (#785 Part B). FS-scan
 * guard: `LINT_FIXTURE_ROOT` (set to the case dir by runGuard) points the axe-spec
 * scan at a fixture tree — a mini `apps/portal/e2e/a11y/*axe*.e2e.spec.ts` set.
 * Fixtures live under `fixtures/axe-exclude/<case>/` and are eslint-ignored
 * (deliberately container-band-excluding specs are data).
 *
 * Root cause (#713): a portal e2e a11y scan excluded the whole `.bg-header`
 * container band via `AxeBuilder.exclude(".bg-header")`; the interactive
 * theme-toggle glyph (#702) sits INSIDE that band, so its contrast escaped the
 * scan — "gate-evasion-by-geography". This guard enforces the interim rule
 * (memory `feedback_axe_exclude_leaf_not_container`): an `.exclude(...)` must be
 * leaf-scoped, or carry a tracking-Issue marker.
 */
const GUARD = "axe-exclude-lint.ts";
const dir = (name: string) => caseDir("axe-exclude", name);

describe("axe-exclude-lint", () => {
  it("red: a container-band `.bg-header` exclude with no marker → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("container-band-no-marker"));
    expect(code).toBe(1);
    expect(stderr).toContain("portal-axe.e2e.spec.ts");
    expect(stderr).toContain(".bg-header");
    expect(stderr).toContain("FAIL");
  });

  it("green: leaf-scoped `[data-testid=…]` excludes → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("leaf-testid"));
    expect(code).toBe(0);
    expect(stdout).toContain("PASS");
  });

  it("red: a bare landmark element exclude (`main`) → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("bare-landmark"));
    expect(code).toBe(1);
    expect(stderr).toContain("landmark-axe.e2e.spec.ts");
    expect(stderr).toContain("main");
  });

  it("green: a container-band exclude WITH a valid `// axe-exclude-ok: #NNN reason` marker → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("container-band-marked"));
    expect(code).toBe(0);
    expect(stdout).toContain("PASS");
  });

  it("red: a marker missing the `#N` or the reason → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("invalid-marker"));
    expect(code).toBe(1);
    expect(stderr).toContain("missing-hash-axe.e2e.spec.ts");
    expect(stderr).toContain("missing-reason-axe.e2e.spec.ts");
  });
});

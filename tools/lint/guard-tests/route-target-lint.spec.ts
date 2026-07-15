import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/route-target-lint.ts` (#676). FS-scan guard:
 * `LINT_FIXTURE_ROOT` (set to the case dir by runGuard) points the app scan at a
 * fixture tree — a mini `apps/portal` / `apps/admin` app-router. Fixtures live
 * under `fixtures/route-targets/<case>/` and are eslint-ignored (deliberately
 * broken trees are data).
 */
const GUARD = "route-target-lint.ts";
const dir = (name: string) => caseDir("route-targets", name);

describe("route-target-lint", () => {
  it("green: every nav target resolves (incl. template + dynamic segments) → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
    expect(stdout).toContain("PASS");
  });

  it("red: /webinars/<slug>/room navigation with no matching route (#673 case) → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-missing-room"));
    expect(code).toBe(1);
    // Names the offending file + the unresolvable target.
    expect(stderr).toContain("join-button.tsx");
    expect(stderr).toContain("/webinars/${slug}/room");
    expect(stderr).toContain("FAIL");
  });
});

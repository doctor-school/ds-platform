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

  it("green: an unresolvable target with a `// route-target-ok: <reason>` suppression → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green-suppressed"));
    expect(code).toBe(0);
    expect(stdout).toContain("PASS");
  });

  it("red: a bare `// route-target-ok:` with no reason does NOT suppress → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-empty-reason"));
    expect(code).toBe(1);
    expect(stderr).toContain("join-button.tsx");
    expect(stderr).toContain("FAIL");
  });
});

/**
 * #1874 — `apps/doctor` nav targets were unchecked: `APPS` named only
 * portal/admin/academy-demo, so the #673 dead-link class was blocked on the
 * academy and invisible on doctor.school (DEBT 2026-09-05, #1722 slice 3).
 */
describe("route-target: apps/doctor is in scope (#1874)", () => {
  it("route-target: apps/doctor dead nav target is a finding", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-doctor-dead-target"));
    expect(code).toBe(1);
    expect(stderr).toContain("join-button.tsx");
    expect(stderr).toContain("/events/${slug}/room");
    expect(stderr).toContain("FAIL");
  });
});

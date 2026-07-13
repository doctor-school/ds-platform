import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/prod-surface-lint.ts` (#771). Covers the
 * inventory failure branches (unclassified route, stale manifest entry,
 * `deferred` without an Issue) and the scaffold-tell backstop — the two red
 * fixtures recreate the REAL pre-fix production surfaces verbatim (the `/`
 * scaffold card and the `/account` session dump at fead3f9, before #769/#770
 * replaced them), which is the Issue's acceptance criterion: the gate must
 * redden on exactly the pages that shipped scaffold-faced to prod.
 *
 * The deferred-Issue OPEN check (gh) is intentionally untestable here: the
 * guard skips it whenever `LINT_FIXTURE_ROOT` is set, so fixture runs never
 * hit the network.
 */
const GUARD = "prod-surface-lint.ts";
const dir = (name: string) => caseDir("prod-surface", name);

describe("prod-surface-lint", () => {
  it("green: all routes classified, clean copy, deferred route exempt from tells → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
  });

  it("red: the real pre-fix `/` scaffold copy (fead3f9) → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-scaffold-copy"));
    expect(code).toBe(1);
    expect(stderr).toContain("scaffold-copy");
  });

  it("red: the real pre-fix `/account` session dump (fead3f9) → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-session-dump"));
    expect(code).toBe(1);
    expect(stderr).toContain("session-dump");
  });

  it("red: a route file with no manifest entry → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-unclassified-route"));
    expect(code).toBe(1);
    expect(stderr).toContain("unclassified-route");
  });

  it("red: a manifest entry pointing at a missing file → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-stale-manifest"));
    expect(code).toBe(1);
    expect(stderr).toContain("stale-manifest-entry");
  });

  it("red: a `deferred` entry without a tracking Issue → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-deferred-no-issue"));
    expect(code).toBe(1);
    expect(stderr).toContain("deferred-missing-issue");
  });
});

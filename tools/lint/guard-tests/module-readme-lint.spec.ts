import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/module-readme-lint.ts` (#438). FS-scan guard:
 * `LINT_FIXTURE_ROOT` (set to the case dir by runGuard) points the module scan at
 * a fixture tree. The `LINT_MODULE_README_ALLOW` env seam replaces the built-in
 * grandfather allowlist so the allowlisted-gap branch is testable through a
 * fixture (the built-in keys on production `apps/api/src/...` paths that never
 * match a fixture root — same limitation asset-format documents).
 */
const GUARD = "module-readme-lint.ts";
const dir = (name: string) => caseDir("module-readme", name);

describe("module-readme-lint", () => {
  it("green: module dir has a README; app-root + nested sub-module exempt → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
    // one top-level module (foo); app.module.ts (root) and foo/bar (nested) folded out.
    expect(stdout).toContain("found 1 top-level NestJS module dir");
  });

  it("red: a module dir without a README → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-missing-readme"));
    expect(code).toBe(1);
    expect(stderr).toContain("missing README");
    expect(stderr).toContain("apps/api/src/foo/README.md");
  });

  it("allow: a grandfathered gap in the allowlist → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("red-missing-readme"), {
      env: {
        LINT_MODULE_README_ALLOW: JSON.stringify({
          "apps/api/src/foo": { issue: 456, reason: "fixture grandfather" },
        }),
      },
    });
    expect(code).toBe(0);
    expect(stdout).toContain("allowlisted");
  });

  it("red: a stale allowlist entry (module HAS a README) → exit 1", () => {
    // Reuses the green fixture (foo has a README) with an allowlist entry for
    // it via the env seam — the entry is now stale and must be a finding
    // (mirrors ears-test-lint's stale-deferral rule, #452).
    const { code, stderr } = runGuard(GUARD, dir("green"), {
      env: {
        LINT_MODULE_README_ALLOW: JSON.stringify({
          "apps/api/src/foo": { issue: 456, reason: "backfilled, entry lingering" },
        }),
      },
    });
    expect(code).toBe(1);
    expect(stderr).toContain("stale allowlist entry");
    expect(stderr).toContain("apps/api/src/foo");
  });
});

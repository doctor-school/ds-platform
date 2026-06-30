import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/showcase-coverage-lint.ts` (#350).
 *
 * The guard reads the package export map + the multi-component index files and
 * dynamically imports the showcase registry — all relative to its `REPO_ROOT`,
 * which the `LINT_FIXTURE_ROOT` filesystem seam stubs. Each case ships the minimal
 * subtree the guard reads (a `packages/design-system/package.json` exports map,
 * the `blocks`/`fields` index when block/field expansion is exercised, and a
 * self-contained `apps/showcase/app/lib/registry.ts` stub) and asserts the exit
 * code + the missing-id message.
 */
const GUARD = "showcase-coverage-lint.ts";
const dir = (name: string) => caseDir("showcase-coverage", name);

describe("showcase-coverage-lint", () => {
  it("green: every package component export has a registry entry → exit 0", () => {
    const { code } = runGuard(GUARD, dir("complete"));
    expect(code).toBe(0);
  });

  it("red: a primitive subpath the registry omits → exit 1, names the id", () => {
    const { code, stderr } = runGuard(GUARD, dir("missing-primitive"));
    expect(code).toBe(1);
    expect(stderr).toContain("input-otp");
    expect(stderr).toContain("no showcase registry entry");
  });

  it("red: a `./blocks` component the registry omits → exit 1, names the id", () => {
    const { code, stderr } = runGuard(GUARD, dir("missing-block"));
    expect(code).toBe(1);
    expect(stderr).toContain("OtpFocusScreen");
  });

  it("green: adding the missing entry fixes it → exit 0", () => {
    const { code } = runGuard(GUARD, dir("with-added-entry"));
    expect(code).toBe(0);
  });
});

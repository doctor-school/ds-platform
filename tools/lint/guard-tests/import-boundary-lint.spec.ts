import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/import-boundary-lint.ts` (#2002 slice C).
 *
 * The guard is the IMPORT-BOUNDARY check of the one-code-two-storefronts plan
 * (tech spec `2026-09-07-one-code-two-storefronts-plan-en.md` §3 rule 3, third
 * bullet): `packages/**` never imports `apps/*` nor another package against the
 * §4 dependency direction, and a host-config module imports nothing from
 * `apps/<host>/{lib,components}` and carries no function-valued field outside the
 * closed adapter list. Those are the two bypasses the spec names verbatim — «a
 * package importing apps/portal/lib/*, a config with an onSuccess callback» —
 * and each has its own fixture root here.
 *
 * Each case points `LINT_FIXTURE_ROOT` at a mini repo tree and asserts the exit
 * code (0 pass / 1 fail) plus a stable message id + substring. Engineering-task,
 * so the test ids are `2002:` rather than EARS ids.
 */
const GUARD = "import-boundary-lint.ts";
const dir = (name: string) => caseDir("import-boundary", name);

describe("import-boundary-lint", () => {
  it("2002: green — a legal auth-flow → room import and a data-only host config → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
    expect(stdout).toContain("OK");
  });

  it("2002: red — a package importing `apps/portal/lib/*`, bare and relative → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-apps-import"));
    expect(code).toBe(1);
    expect(stderr).toContain("package-import-boundary");
    expect(stderr).toContain("must not import a storefront");
    // Both the bare specifier and the relative climb are caught.
    expect(stderr).toContain("packages/room/src/x.ts");
    expect(stderr).toContain("packages/room/src/y.ts");
  });

  it("2002: red — sibling and base-to-feature imports against the §4 graph → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-direction"));
    expect(code).toBe(1);
    expect(stderr).toContain("`@ds/events-storefront` must not import `@ds/room`");
    expect(stderr).toContain("`@ds/design-system` must not import `@ds/events-storefront`");
  });

  it("2002: red — a host config importing `@/lib/*` and carrying an `onSuccess` callback → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-host-config"));
    expect(code).toBe(1);
    expect(stderr).toContain("host-config-boundary");
    expect(stderr).toContain("must not import host logic");
    expect(stderr).toContain("onSuccess");
  });
});

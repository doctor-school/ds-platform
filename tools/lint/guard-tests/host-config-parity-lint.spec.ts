import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/host-config-parity-lint.ts` (#2443). Each case
 * points `LINT_FIXTURE_ROOT` at a fixture tree holding the two storefronts' host
 * configs and the package manifests at their real repo paths, and
 * `HOST_CONFIG_PARITY_BASE_DIR` at the case's `base/` dir — the stand-in for the
 * `git cat-file blob origin/<base>:<spec>` read, so the base-vs-head distinction is
 * testable without a git history. A case with no `base/` dir has no spec table on
 * base at all.
 */
const GUARD = "host-config-parity-lint.ts";
const run = (name: string) => {
  const dir = caseDir("host-config-parity", name);
  return runGuard(GUARD, dir, {
    env: { HOST_CONFIG_PARITY_BASE_DIR: resolve(dir, "base") },
  });
};

describe("host-config-parity-lint", () => {
  it("green: hosts differ only in presentation/brand/route/envelope values, no spec table needed → exit 0", () => {
    const { code, stderr } = run("green-presentation-only");
    expect(stderr).toBe("");
    expect(code).toBe(0);
  });

  it("green: every product difference matches its base-branch spec row (literal and presence-only cells) → exit 0", () => {
    const { code, stderr } = run("green-difference-matches-row");
    expect(stderr).toBe("");
    expect(code).toBe(0);
  });

  it("green: the base row is present but the hosts are now EQUAL (a difference being removed) → exit 0", () => {
    const { code, stderr } = run("green-equal-hosts-row-on-base");
    expect(stderr).toBe("");
    expect(code).toBe(0);
  });

  it("red: the hosts still differ and the head tree drops the row the base branch cites → exit 1", () => {
    const { code, stderr } = run("red-row-removed-on-head");
    expect(code).toBe(1);
    expect(stderr).toContain("`register.promoField`");
    expect(stderr).toContain("head tree");
    expect(stderr).toContain(
      "apps/docs/content/specs/features/021-doctor-registration/021-requirements-en.md",
    );
  });

  it("red: a product-difference field differs with no row in the base spec table → exit 1", () => {
    const { code, stderr } = run("red-no-spec-row");
    expect(code).toBe(1);
    expect(stderr).toContain("AuthFlowHostConfig");
    expect(stderr).toContain("`register.promoField`");
    expect(stderr).toContain("Витрина");
    expect(stderr).toContain("true");
    expect(stderr).toContain("Академия");
    expect(stderr).toContain("false");
    expect(stderr).toContain(
      "apps/docs/content/specs/features/021-doctor-registration/021-requirements-en.md",
    );
    expect(stderr).toContain("no row");
  });

  it("red: a host value disagrees with the literal its spec row leads with → exit 1", () => {
    const { code, stderr } = run("red-value-mismatch");
    expect(code).toBe(1);
    expect(stderr).toContain("`register.promoField`");
    expect(stderr).toContain("Академия");
    expect(stderr).toContain("row states `true`");
  });

  it("red: the row exists only on the head tree, not on the base branch → exit 1", () => {
    const { code, stderr } = run("red-row-head-only");
    expect(code).toBe(1);
    expect(stderr).toContain("`register.promoField`");
    expect(stderr).toContain("no row");
  });

  it("red: a host config sets a key the field table does not classify → exit 1", () => {
    const { code, stderr } = run("red-unclassified-key");
    expect(code).toBe(1);
    expect(stderr).toContain("`register.newToggle`");
    expect(stderr).toContain("unclassified");
  });

  it("red: an auth-flow mechanics key reappears in a host config → exit 1", () => {
    const { code, stderr } = run("red-mechanics-key");
    expect(code).toBe(1);
    expect(stderr).toContain("`channels`");
    expect(stderr).toContain("mechanics");
  });
});

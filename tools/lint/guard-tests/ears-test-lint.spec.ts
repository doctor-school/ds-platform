import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Harness for `tools/lint/ears-test-lint.ts` (#316 origin, #437 folding + fail).
 *
 * The guard owns the COVERAGE + ORPHAN direction of the bidirectional EARS↔test
 * contract and, since #437, **exits non-zero on findings** (the WARN→BLOCK
 * prerequisite). Assertions key off BOTH the exit code and the stdout messages.
 * The `LINT_FIXTURE_ROOT` seam points the scan at a fixture tree carrying a tiny
 * `NNN-requirements.md` spec + a sample test; `LINT_EARS_DEFERRALS` (JSON) is the
 * second seam that replaces the built-in deferral allowlist for a deterministic run.
 *
 * Folding semantics under test (ADR-0006 §4 — flat-by-default, nested `N.M` only
 * when a handler carries multiple shall-clauses):
 *   - fold-nested-test : a FLAT spec id is covered by any NESTED test under it.
 *   - fold-flat-test   : NESTED spec ids are covered by the FLAT whole-handler test.
 *   - sibling-gap      : a sibling nested id (EARS-3.1) does NOT cover EARS-3.2.
 *   - cross-number     : EARS-1 and EARS-18 never fold (component-wise prefix).
 *   - deferred/stale   : the allowlist mechanism (accept + stale-detection).
 */
const GUARD = "ears-test-lint.ts";
const dir = (name: string) => caseDir("ears-test", name);

// A fixture-only deferral allowlist injected via the LINT_EARS_DEFERRALS seam so
// the mechanism is tested independently of the built-in (production) entries.
const DEFER_EARS_7 = {
  LINT_EARS_DEFERRALS: JSON.stringify({
    "EARS-7": { issue: 999, reason: "fixture-only deferral" },
  }),
};

describe("ears-test-lint", () => {
  it("covered: a requirement cited by a matching test title → no findings, exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("covered"));
    expect(code).toBe(0);
    expect(stdout).toContain("no orphans");
  });

  it("uncovered: a declared requirement no test title references → finding, exit 1", () => {
    const { code, stdout } = runGuard(GUARD, dir("uncovered"));
    expect(code).toBe(1);
    expect(stdout).toContain("EARS-2 declared");
    expect(stdout).toContain("no test title references it");
  });

  it("orphan: a test title cites an id no spec declares → finding, exit 1", () => {
    const { code, stdout } = runGuard(GUARD, dir("orphan"));
    expect(code).toBe(1);
    expect(stdout).toContain("Orphan EARS reference EARS-9");
  });

  it("fold-nested-test: a flat spec id (EARS-18) is covered by nested test titles → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("fold-nested-test"));
    expect(code).toBe(0);
    expect(stdout).not.toContain("WARN");
    expect(stdout).toContain("no orphans");
  });

  it("fold-flat-test: nested spec ids (EARS-1.1/1.2) are covered by a flat test title → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("fold-flat-test"));
    expect(code).toBe(0);
    expect(stdout).not.toContain("WARN");
    expect(stdout).toContain("no orphans");
  });

  it("sibling-gap: a sibling nested id does NOT cover EARS-3.2 → finding, exit 1", () => {
    const { code, stdout } = runGuard(GUARD, dir("sibling-gap"));
    expect(code).toBe(1);
    expect(stdout).toContain("EARS-3.2 declared");
    expect(stdout).toContain("no test title references it");
    // EARS-3.1 IS covered — it must NOT be reported.
    expect(stdout).not.toContain("EARS-3.1 declared");
  });

  it("cross-number: EARS-1 and EARS-18 never fold → both an uncovered AND an orphan finding, exit 1", () => {
    const { code, stdout } = runGuard(GUARD, dir("cross-number"));
    expect(code).toBe(1);
    expect(stdout).toContain("EARS-1 declared");
    expect(stdout).toContain("Orphan EARS reference EARS-18");
  });

  it("deferred: an allowlisted uncovered id is accepted (info, not a finding) → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("deferred"), {
      env: DEFER_EARS_7,
    });
    expect(code).toBe(0);
    expect(stdout).toContain("deferred");
    expect(stdout).toContain("EARS-7");
    expect(stdout).toContain("#999");
    // A deferral is NOT a coverage warning.
    expect(stdout).not.toContain("EARS-7 declared");
  });

  it("stale-deferral: an allowlisted id that IS covered → stale finding, exit 1", () => {
    const { code, stdout } = runGuard(GUARD, dir("stale-deferral"), {
      env: DEFER_EARS_7,
    });
    expect(code).toBe(1);
    expect(stdout).toContain("stale");
    expect(stdout).toContain("EARS-7");
  });
});

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
 *
 * Spec-scoping (#612 — EARS ids are unique only WITHIN a feature-spec, ADR-0006
 * §4). Coverage, orphan-detection, and the deferral allowlist are all keyed by
 * `feature:id`, and a test file inherits a feature scope from any `NNN EARS-…`
 * prefix in its titles (absent → feature-agnostic, the legacy default):
 *   - cross-spec-collision : a 007-scoped `EARS-4` test neither covers nor stales
 *     003's separately-numbered `EARS-4` deferral.
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

  // #612 — a 007-scoped `EARS-4` test must neither satisfy nor stale-flag the
  // 003-scoped `EARS-4` deferral (the two features own unrelated EARS-4s). The
  // deferral's `info:` line still prints and no stale finding fires.
  it("cross-spec-collision: 003:EARS-4 deferral is honored and NOT staled by a 007 EARS-4 test → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("cross-spec-collision"), {
      env: {
        LINT_EARS_DEFERRALS: JSON.stringify({
          "003:EARS-4": { issue: 454, reason: "scoped fixture deferral" },
        }),
      },
    });
    expect(code).toBe(0);
    expect(stdout).toContain("deferred");
    expect(stdout).toContain("003:EARS-4");
    expect(stdout).toContain("#454");
    // The 007 test is scope-incompatible with 003 → it must not stale the deferral.
    expect(stdout).not.toContain("stale");
    // The 007 EARS-4 test is declared in 007's spec → not an orphan.
    expect(stdout).toContain("no orphans");
  });

  // #612 — the scoped-key staleness path still fires when a SCOPE-COMPATIBLE test
  // covers the deferred id (here an agnostic EARS-7 test against a `003:EARS-7`
  // deferral). Proves the ratchet still tightens under the scoped keyspace.
  it("scoped stale-deferral: a 003:EARS-7 deferral covered by a compatible test → stale finding, exit 1", () => {
    const { code, stdout } = runGuard(GUARD, dir("stale-deferral"), {
      env: {
        LINT_EARS_DEFERRALS: JSON.stringify({
          "003:EARS-7": { issue: 999, reason: "scoped fixture deferral" },
        }),
      },
    });
    expect(code).toBe(1);
    expect(stdout).toContain("stale");
    expect(stdout).toContain("003:EARS-7");
  });
});

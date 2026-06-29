import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Harness for `tools/lint/ears-test-lint.ts` (#316, the COVERAGE + ORPHAN direction
 * of the bidirectional EARS↔test contract). This guard is a pure WARN nudge — it
 * always exits 0 — so the assertions key off its stdout messages, not the exit code
 * (the seam points `LINT_FIXTURE_ROOT` at a fixture tree carrying a tiny
 * `NNN-requirements.md` spec + a sample test).
 *
 * - covered  : the spec id is cited by a test title → "no orphans"
 * - uncovered: a declared requirement no test title cites → forward WARN
 * - orphan   : a test title cites an id no spec declares → backward WARN
 */
const GUARD = "ears-test-lint.ts";
const dir = (name: string) => caseDir("ears-test", name);

describe("ears-test-lint", () => {
  it("covered: a requirement cited by a matching test title → no warnings, exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("covered"));
    expect(code).toBe(0);
    expect(stdout).toContain("no orphans");
  });

  it("uncovered: a declared requirement no test title references → forward WARN", () => {
    const { code, stdout } = runGuard(GUARD, dir("uncovered"));
    expect(code).toBe(0); // WARN guard never fails CI
    expect(stdout).toContain("EARS-2 declared");
    expect(stdout).toContain("no test title references it");
  });

  it("orphan: a test title cites an id no spec declares → backward WARN", () => {
    const { code, stdout } = runGuard(GUARD, dir("orphan"));
    expect(code).toBe(0);
    expect(stdout).toContain("Orphan EARS reference EARS-9");
  });
});

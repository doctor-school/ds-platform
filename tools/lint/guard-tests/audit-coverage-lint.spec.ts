import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/audit-coverage-lint.ts` (010 EARS-8, #1089).
 * The guard asserts every table declared in the `packages/db` schema is EITHER
 * covered by an `audit_row_change()` trigger attached in the migration chain OR
 * present in the `AUDIT_CAPTURE_ALLOWLIST` (with a recorded rationale) — so a new
 * domain table cannot silently ship unaudited.
 *
 * In fixture mode (`LINT_FIXTURE_ROOT`) the guard reads a minimal mirror of the
 * real layout under the case dir: `packages/db/src/schema/*.ts` (enumeration),
 * `packages/db/src/audit.ts` (allowlist — the same TS registry it imports in
 * production), and `apps/api/drizzle/*.sql` (trigger-attach chain).
 */
const GUARD = "audit-coverage-lint.ts";
const dir = (name: string) => caseDir("audit-coverage", name);

describe("audit-coverage-lint", () => {
  it("010 EARS-8: green — every schema table triggered or allowlisted → exit 0, rationale printed", () => {
    const { code, stdout } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
    expect(stdout).toContain("[audit-coverage]");
    // The allowlist rationale is surfaced on pass (AC: "no bare names").
    expect(stdout).toContain("telemetry");
    expect(stdout).toContain("widget_b");
  });

  it("010 EARS-8: green — an audit_ledger partition child table in a migration is not a schema table → no false positive", () => {
    // The partition-noise CREATE TABLE lives only in the green fixture's
    // migration, never in its schema files; the guard must ignore it.
    const { code } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
  });

  it("010 EARS-8: red — a schema table with no trigger and no allowlist entry → exit 1, names the table + both remedies", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-uncovered"));
    expect(code).toBe(1);
    expect(stderr).toContain("widget_c");
    // Both remedies are named: attach the trigger OR allowlist with a rationale.
    expect(stderr).toMatch(/trigger/i);
    expect(stderr).toMatch(/allowlist/i);
  });

  it("010 EARS-8: red — an allowlist entry with a blank rationale (a bare name) → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-bare-allowlist"));
    expect(code).toBe(1);
    expect(stderr).toContain("widget_b");
    expect(stderr).toMatch(/rationale/i);
  });

  it("010 EARS-8: red — a trigger attached then later DROPped leaves its table uncovered → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-dropped-trigger"));
    expect(code).toBe(1);
    expect(stderr).toContain("widget_a");
  });
});

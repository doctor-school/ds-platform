import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/retained-data-lint.ts` (#1404, slice C of
 * #1278). Covers both failure classes (a NEW cascade FK, a NEW physical delete),
 * the baselined pass path, the shrink-only enforcement (a stale baseline is red),
 * and the two false-positive guards (in-memory container deletes, an
 * acknowledged suppression).
 */
const GUARD = "retained-data-lint.ts";
const dir = (name: string) => caseDir("retained-data", name);

describe("retained-data-lint", () => {
  it('red: a NEW `onDelete: "cascade"` FK with no baseline entry → exit 1', () => {
    const { code, stderr } = runGuard(GUARD, dir("red-new-cascade"));
    expect(code).toBe(1);
    expect(stderr).toContain("new-cascade");
    expect(stderr).toContain("packages/db/src/schema/notes.ts");
  });

  it("red: NEW physical deletes (single-line and multi-line Drizzle) → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-new-physical-delete"));
    expect(code).toBe(1);
    expect(stderr).toContain("new-physical-delete");
    // Both the `this.db.delete(` line and the `await db` ⏎ `.delete(` continuation.
    expect(stderr).toContain("2 NEW occurrence(s)");
  });

  it("green: occurrences recorded in the baseline → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green-baselined"));
    expect(code).toBe(0);
    expect(stdout).toContain("PASS");
  });

  it("red: a baselined occurrence removed without shrinking the baseline → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-stale-baseline"));
    expect(code).toBe(1);
    expect(stderr).toContain("stale-baseline");
    expect(stderr).toContain("SAME PR");
  });

  it("green: in-memory container deletes (Map/headers) are not row removal → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green-container-delete"));
    expect(code).toBe(0);
  });

  it("green: a `// retained-data-ok: <reason>` suppression → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green-suppressed"));
    expect(code).toBe(0);
  });
});

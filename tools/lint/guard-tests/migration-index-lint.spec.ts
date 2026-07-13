import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/migration-index-lint.ts` (#799). Parallel
 * branches independently generating the same next Drizzle migration index is a
 * silent merge hazard (a sibling migration gets dropped) — the guard fails on:
 *
 *   1. duplicate-idx        — two local `_journal.json` entries share an `idx`
 *   2. duplicate-file-prefix — two `apps/api/drizzle/*.sql` share a `NNNN` prefix
 *   3. index-collision      — a branch-new entry's idx ≤ max idx on origin/main
 *   4. dropped-base-entry   — an origin/main entry is missing from the branch
 *
 * In fixture mode (`LINT_FIXTURE_ROOT`) the origin/main base journal is read
 * from `<root>/origin-main/_journal.json` instead of git.
 */
const GUARD = "migration-index-lint.ts";
const dir = (name: string) => caseDir("migration-index", name);

// The remedy the red-case output must name (Issue #799 AC).
const REMEDY = /rebase.+origin\/main/i;

describe("migration-index-lint", () => {
  it("green: branch-new migration above base max, superset journal → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
    expect(stdout).toContain("[migration-index]");
  });

  it("green: branch merely behind origin/main (no new migrations) → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green-behind-main"));
    expect(code).toBe(0);
  });

  it("red: branch-new idx ≤ origin/main max (the #705 collision) → exit 1 + remedy", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-index-collision"));
    expect(code).toBe(1);
    expect(stderr).toContain("index-collision");
    expect(stderr).toMatch(REMEDY);
    expect(stderr).toContain("drizzle:generate");
  });

  it("red: duplicate idx inside the local journal → exit 1 + remedy", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-duplicate-idx"));
    expect(code).toBe(1);
    expect(stderr).toContain("duplicate-idx");
    expect(stderr).toMatch(REMEDY);
  });

  it("red: a base (origin/main) journal entry dropped by the branch → exit 1 + remedy", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-dropped-base-entry"));
    expect(code).toBe(1);
    expect(stderr).toContain("dropped-base-entry");
    expect(stderr).toMatch(REMEDY);
  });

  it("red: two SQL files sharing a numeric prefix → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-duplicate-file-prefix"));
    expect(code).toBe(1);
    expect(stderr).toContain("duplicate-file-prefix");
  });

  it("green: base journal unobtainable → SKIP, exit 0 (never a false red)", () => {
    const { code, stdout } = runGuard(GUARD, dir("skip-no-base"));
    expect(code).toBe(0);
    expect(stdout).toContain("SKIP");
  });
});

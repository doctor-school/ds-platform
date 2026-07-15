import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/no-stub-lint.ts` (#286). Covers both failure
 * branches (user-facing env-placeholder, untracked stub marker) and the two
 * pass paths (a TODO citing a tracked Issue, and the `// no-stub-ok:` escape).
 */
const GUARD = "no-stub-lint.ts";
const dir = (name: string) => caseDir("no-stub", name);

describe("no-stub-lint", () => {
  it("green: clean user-facing source → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
  });

  it("red: a user-facing env-placeholder leak → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-env-placeholder"));
    expect(code).toBe(1);
    expect(stderr).toContain("user-facing-env-placeholder");
  });

  it("red: an untracked TODO/FIXME marker → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-untracked-todo"));
    expect(code).toBe(1);
    expect(stderr).toContain("untracked-stub-marker");
  });

  it("green: a TODO citing a tracked Issue (#123) → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green-todo-tracked"));
    expect(code).toBe(0);
  });

  it("green: a `// no-stub-ok: <reason>` suppression → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green-suppressed"));
    expect(code).toBe(0);
  });

  it("red: a bare `// no-stub-ok:` with no reason does NOT suppress → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-empty-reason"));
    expect(code).toBe(1);
    expect(stderr).toContain("untracked-stub-marker");
  });
});

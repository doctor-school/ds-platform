import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/instruction-budget-lint.ts` (#293).
 *
 * Two seams drive this guard: `LINT_FIXTURE_ROOT` (set to the case dir by
 * runGuard) points the always-on repo-file checks (AGENTS.md, CLAUDE.md,
 * .claude/rules/*.md) at a fixture tree, and `LINT_MEMORY_FILE` points the
 * MEMORY.md check at a fixture file directly — bypassing the HOME + project-slug
 * derivation, which is machine-specific and cannot be pre-laid-out as a fixture.
 *
 * Covers the green path, the repo-file over-budget branch (an AGENTS.md past 200
 * lines), and the auto-memory over-budget branch (a MEMORY.md past 200 lines).
 */
const GUARD = "instruction-budget-lint.ts";
const memoryFile = (name: string) =>
  resolve(caseDir("instruction-budget", name), "memory", "MEMORY.md");

describe("instruction-budget-lint", () => {
  it("green: all always-on files + memory within budget → exit 0", () => {
    const { code, stdout } = runGuard(
      GUARD,
      caseDir("instruction-budget", "green"),
      { env: { LINT_MEMORY_FILE: memoryFile("green") } },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("PASS");
  });

  it("red: an always-on repo file (AGENTS.md) over the 200-line ceiling → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      caseDir("instruction-budget", "red-over-budget"),
    );
    expect(code).toBe(1);
    expect(stderr).toContain("AGENTS.md");
    expect(stderr).toContain("> 200");
  });

  it("red: the auto-memory MEMORY.md over the 200-line cutoff → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      caseDir("instruction-budget", "red-memory-over-budget"),
      { env: { LINT_MEMORY_FILE: memoryFile("red-memory-over-budget") } },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("MEMORY.md");
    expect(stderr).toContain("> 200");
  });
});

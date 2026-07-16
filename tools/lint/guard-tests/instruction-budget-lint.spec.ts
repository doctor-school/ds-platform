import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

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
 * lines), the auto-memory over-budget branch (a MEMORY.md past 200 lines), and
 * the read-on-demand skills group (#416): a within-budget skill reports `ok`, an
 * over-budget skill WARNs without failing the run (Phase-0 WARN posture), and the
 * byte-headroom WARN tier (#1042): an always-on file within budget but with
 * < 256 B left before the 25 KB ceiling WARNs without failing; comfortable
 * headroom stays silent; over-budget still fails. The headroom fixtures need
 * byte-exact sizes, so they are generated at run time under a temp fixture root
 * (platform-agnostic — no committed near-ceiling blobs).
 */
const GUARD = "instruction-budget-lint.ts";
const memoryFile = (name: string) =>
  resolve(caseDir("instruction-budget", name), "memory", "MEMORY.md");

const MAX_BYTES = 25 * 1024; // mirrors the guard's byte ceiling

/** ASCII content of exactly `totalBytes` bytes, well under the 200-line ceiling. */
const sizedMd = (totalBytes: number): string => {
  const header = "# AGENTS.md sized fixture\n";
  const body = totalBytes - header.length;
  const lineLen = 512; // 511 chars + newline per full line
  const full = Math.floor(body / lineLen);
  return header + ("x".repeat(lineLen - 1) + "\n").repeat(full) + "x".repeat(body % lineLen);
};

const tempRoots: string[] = [];

/** Temp fixture root with AGENTS.md at exactly `agentsBytes` + a small CLAUDE.md. */
const headroomCase = (agentsBytes: number): string => {
  const root = mkdtempSync(join(tmpdir(), "instruction-budget-headroom-"));
  tempRoots.push(root);
  writeFileSync(join(root, "AGENTS.md"), sizedMd(agentsBytes));
  writeFileSync(join(root, "CLAUDE.md"), "# CLAUDE.md fixture\n\nComfortable headroom.\n");
  return root;
};

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

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

  it("skills: an over-budget SKILL.md WARNs but does NOT fail the run (Phase-0 #416)", () => {
    const { code, stdout, stderr } = runGuard(
      GUARD,
      caseDir("instruction-budget", "skills"),
    );
    // Skills are read-on-demand → over-budget is a WARN, so the run still passes.
    expect(code).toBe(0);
    expect(stdout).toContain("PASS");
    // The within-budget skill is scanned and reported ok…
    expect(stdout).toContain("skill: tiny-skill");
    // …and the over-budget skill is surfaced as a WARN, not a failure.
    expect(stdout).toContain("WARN");
    expect(stderr).toContain("bloated-skill");
    expect(stderr).toContain("WARN");
  });

  it("headroom (#1042): an always-on file < 256 B under the byte ceiling → WARN, exit 0", () => {
    const { code, stdout } = runGuard(GUARD, headroomCase(MAX_BYTES - 100));
    expect(code).toBe(0);
    expect(stdout).toContain("PASS");
    expect(stdout).toContain("WARN");
    expect(stdout).toContain("low byte-headroom");
    expect(stdout).toContain("AGENTS.md");
    expect(stdout).toContain("100 B remaining");
  });

  it("headroom (#1042): comfortable headroom (>= 256 B) → no WARN, exit 0", () => {
    const { code, stdout } = runGuard(GUARD, headroomCase(MAX_BYTES - 1024));
    expect(code).toBe(0);
    expect(stdout).toContain("PASS");
    expect(stdout).not.toContain("WARN");
  });

  it("headroom (#1042): over the byte ceiling still hard-FAILs → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, headroomCase(MAX_BYTES + 10));
    expect(code).toBe(1);
    expect(stderr).toContain("AGENTS.md");
    expect(stderr).toContain("KB >");
  });
});

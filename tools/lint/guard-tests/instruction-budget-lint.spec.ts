import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
 *
 * The always-on TOTAL group (#1678) additionally pins the cap's determinism
 * (#1680): the total verdict must be byte-identical with and without a
 * resolvable MEMORY.md (that file lives outside git, so counting it would split
 * the verdict between CI and a developer's box), and 30 KB exactly still passes.
 *
 * The last group covers the `paths:` frontmatter classifier (#1370), which
 * decides whether a `.claude/rules/*.md` file counts toward the always-on total
 * at all — ~21 KB of session window rests on it, so every shape Claude Code
 * treats as always-on must be classified always-on here. Those fixtures are also
 * generated at run time: they are byte-shape assertions (what sits at byte 0,
 * where the closing delimiter is), which a committed fixture's trailing-newline
 * or BOM handling could quietly perturb.
 */
const GUARD = "instruction-budget-lint.ts";
const memoryFile = (name: string) =>
  resolve(caseDir("instruction-budget", name), "memory", "MEMORY.md");

const MAX_BYTES = 25 * 1024; // mirrors the guard's byte ceiling
const MAX_LINES = 200; // mirrors the guard's line ceiling

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

/**
 * Temp fixture root sizing BOTH always-on repo files (#1678) — the total-cap
 * seam: each file byte-exact and individually legal, so only their sum can trip
 * the guard.
 */
const totalCase = (agentsBytes: number, claudeBytes: number): string => {
  const root = mkdtempSync(join(tmpdir(), "instruction-budget-total-"));
  tempRoots.push(root);
  writeFileSync(join(root, "AGENTS.md"), sizedMd(agentsBytes));
  writeFileSync(join(root, "CLAUDE.md"), sizedMd(claudeBytes));
  return root;
};

/** A byte-exact MEMORY.md fixture in its own temp dir; returns its path. */
const memoryFixture = (bytes: number): string => {
  const root = mkdtempSync(join(tmpdir(), "instruction-budget-memory-"));
  tempRoots.push(root);
  const path = join(root, "MEMORY.md");
  writeFileSync(path, sizedMd(bytes));
  return path;
};

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

/**
 * Temp fixture root with a small AGENTS.md + CLAUDE.md and ONE
 * `.claude/rules/<name>` written verbatim — the seam for the `paths:`
 * frontmatter classifier (#1370). The rules body is passed byte-exact because
 * the whole point of the classifier is WHERE the `---` block sits.
 */
const rulesCase = (name: string, rulesBody: string): string => {
  const root = mkdtempSync(join(tmpdir(), "instruction-budget-rules-"));
  tempRoots.push(root);
  writeFileSync(join(root, "AGENTS.md"), "# AGENTS.md fixture\n");
  writeFileSync(join(root, "CLAUDE.md"), "# CLAUDE.md fixture\n");
  mkdirSync(join(root, ".claude", "rules"), { recursive: true });
  writeFileSync(join(root, ".claude", "rules", name), rulesBody);
  return root;
};

/** The guard's whole `always-on total:` summary line. */
const totalLine = (stdout: string): string => {
  const m = /^.*always-on total:.*$/m.exec(stdout);
  if (!m) throw new Error(`no always-on total line in guard output:\n${stdout}`);
  return m[0];
};

/** The `lines` figure from the guard's `always-on total:` summary line. */
const totalLines = (stdout: string): number => {
  const m = /always-on total: (\d+) lines/.exec(stdout);
  if (!m) throw new Error(`no always-on total line in guard output:\n${stdout}`);
  return Number(m[1]);
};

/** Line count exactly as the guard computes it (split on \r?\n). */
const countLines = (s: string): number => s.split(/\r?\n/).length;

const AGENTS_FIXTURE_LINES = countLines("# AGENTS.md fixture\n");
const CLAUDE_FIXTURE_LINES = countLines("# CLAUDE.md fixture\n");
/** Always-on total when the rules file is OFF the total (lazy). */
const BASE_LINES = AGENTS_FIXTURE_LINES + CLAUDE_FIXTURE_LINES;

const PATHS_FRONTMATTER = '---\npaths:\n  - "infra/**"\n---\n\n';

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

  // ── always-on TOTAL cap (#1678) ────────────────────────────────────────────
  // Per-file caps cannot bound the session window: several files each inside the
  // 25 KB per-file ceiling still open an arbitrarily large session, and context
  // rot is a function of the total. The total is a hard FAIL, like a per-file
  // overrun — and it must fire while every individual file is comfortably legal.

  it("#1678: always-on total over 30 KB FAILs even with every file individually in budget", () => {
    const { code, stdout, stderr } = runGuard(GUARD, totalCase(20 * 1024, 11 * 1024));
    // Neither file is over the 25 KB per-file ceiling…
    expect(stderr).not.toContain("AGENTS.md:");
    expect(stderr).not.toContain("CLAUDE.md:");
    // …but 31 KB of always-on window is over the total cap.
    expect(code).toBe(1);
    expect(stdout).toContain("OVER BUDGET always-on total");
    expect(stderr).toContain("always-on total");
    expect(stderr).toContain("30 KB");
  });

  it("#1678: always-on total at or under 30 KB passes", () => {
    const { code, stdout } = runGuard(GUARD, totalCase(20 * 1024, 9 * 1024));
    expect(code).toBe(0);
    expect(stdout).toContain("PASS");
    expect(stdout).toContain("(limit 30 KB)");
  });

  it("#1678: the total verdict is IDENTICAL with and without a resolvable MEMORY.md (#1680)", () => {
    // MEMORY.md lives outside git — counting it would make the total green in CI
    // (no auto-memory dir) and red on a developer's box. The verdict must be a
    // pure function of the repo-tracked always-on files.
    const root = totalCase(20 * 1024, 9 * 1024); // 29 KB — legal
    const without = runGuard(GUARD, root);
    const withMemory = runGuard(GUARD, root, {
      env: { LINT_MEMORY_FILE: memoryFixture(20 * 1024) }, // individually legal, 20 KB
    });
    expect(without.code).toBe(0);
    expect(withMemory.code).toBe(0);
    // Same bytes, same lines, same "ok" verdict — the memory file moved nothing.
    expect(totalLine(withMemory.stdout)).toBe(totalLine(without.stdout));
    // …and the memory file WAS scanned (per-file budget still applies to it).
    expect(withMemory.stdout).toContain("MEMORY.md (auto-memory index)");
  });

  it("#1678: a total of exactly 30 KB is within budget (boundary is inclusive)", () => {
    const { code, stdout } = runGuard(GUARD, totalCase(20 * 1024, 10 * 1024));
    expect(code).toBe(0);
    expect(stdout).toContain("PASS");
    expect(totalLine(stdout)).toContain("30.0 KB");
    expect(totalLine(stdout)).not.toContain("OVER BUDGET");
  });

  // ── `paths:` frontmatter classification (#1370) ────────────────────────────
  // Claude Code loads a .claude/rules/*.md file at session start UNLESS it opens
  // with real YAML frontmatter (first bytes of the file) declaring a top-level
  // `paths` key. That file is then glob-triggered — off the always-on TOTAL, but
  // still budget-checked as an on-demand file. Everything else is always-on. The
  // guard is the only mechanism accounting for ~21 KB of window, so each shape
  // that Claude Code treats as always-on must be classified always-on here too.

  it("#1370 (a): a path-less rules file is always-on and counts toward the total", () => {
    const body = "# Plain rules\n\nNo frontmatter at all.\n";
    const { code, stdout } = runGuard(GUARD, rulesCase("plain.md", body));
    expect(code).toBe(0);
    expect(stdout).toContain(".claude/rules/plain.md (always-on)");
    expect(totalLines(stdout)).toBe(BASE_LINES + countLines(body));
  });

  it("#1370 (b): byte-0 `paths:` frontmatter → OFF the total but still budget-checked", () => {
    const lazy = `${PATHS_FRONTMATTER}# Lazy rules\n\nGlob-triggered.\n`;
    const { code, stdout } = runGuard(GUARD, rulesCase("lazy.md", lazy));
    expect(code).toBe(0);
    expect(stdout).toContain(".claude/rules/lazy.md (lazy)");
    // Off the always-on total: the total is AGENTS.md + CLAUDE.md only.
    expect(totalLines(stdout)).toBe(BASE_LINES);

    // …but NOT dropped from checking: the same file past the 200-line ceiling
    // still hard-FAILs. Off-total is not off-budget.
    const bloated = `${PATHS_FRONTMATTER}${"filler\n".repeat(MAX_LINES + 10)}`;
    const over = runGuard(GUARD, rulesCase("lazy.md", bloated));
    expect(over.code).toBe(1);
    expect(over.stderr).toContain("lazy.md");
    expect(over.stderr).toContain("> 200");
  });

  it("#1370 (c): an HTML comment ABOVE the `---` block is NOT frontmatter → always-on", () => {
    // Regression for the detector bug: a multiline-anchored /^---[\s\S]*?paths:/
    // matches this shape, so the file was dropped from the always-on total while
    // Claude Code still loaded it every session. Frontmatter must start at byte 0.
    const body = `<!-- Auto-loaded reference. -->\n\n${PATHS_FRONTMATTER}# Rules\n\nBody.\n`;
    const { code, stdout } = runGuard(GUARD, rulesCase("commented.md", body));
    expect(code).toBe(0);
    expect(stdout).toContain(".claude/rules/commented.md (always-on)");
    expect(totalLines(stdout)).toBe(BASE_LINES + countLines(body));
  });

  it("#1370 (d): the bare word `paths:` in the body is not frontmatter → always-on", () => {
    const body = "# Rules\n\nSee the `paths:` frontmatter docs.\n\n---\n\npaths: matter.\n";
    const { code, stdout } = runGuard(GUARD, rulesCase("mentions.md", body));
    expect(code).toBe(0);
    expect(stdout).toContain(".claude/rules/mentions.md (always-on)");
    expect(totalLines(stdout)).toBe(BASE_LINES + countLines(body));
  });

  it("#1370 (e): an unterminated `---` block is not frontmatter → always-on", () => {
    const body = '---\npaths:\n  - "infra/**"\n\n# Rules\n\nNo closing delimiter.\n';
    const { code, stdout } = runGuard(GUARD, rulesCase("unterminated.md", body));
    expect(code).toBe(0);
    expect(stdout).toContain(".claude/rules/unterminated.md (always-on)");
    expect(totalLines(stdout)).toBe(BASE_LINES + countLines(body));
  });

  it("#1370 (f): `paths` nested under another key is not a top-level key → always-on", () => {
    const body = '---\ndescription: x\nmeta:\n  paths:\n    - "infra/**"\n---\n\n# Rules\n';
    const { code, stdout } = runGuard(GUARD, rulesCase("nested.md", body));
    expect(code).toBe(0);
    expect(stdout).toContain(".claude/rules/nested.md (always-on)");
    expect(totalLines(stdout)).toBe(BASE_LINES + countLines(body));
  });

  it("#1370 (g): a UTF-8 BOM before the frontmatter is tolerated → lazy", () => {
    const { code, stdout } = runGuard(
      GUARD,
      rulesCase("bom.md", `\uFEFF${PATHS_FRONTMATTER}# Rules\n`),
    );
    expect(code).toBe(0);
    expect(stdout).toContain(".claude/rules/bom.md (lazy)");
    expect(totalLines(stdout)).toBe(BASE_LINES);
  });
});

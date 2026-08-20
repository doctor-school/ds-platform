import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Merge-command alignment guard (#1317).
 *
 * The always-on contract (AGENTS.md §4), the on-demand rules file
 * (`.claude/rules/repo-conventions.md` → Branches) and the procedure
 * (`merge-when-green` SKILL.md Step 2) must name ONE authoritative closeout
 * command — guarded `pnpm pr:land <N>` from the MAIN tree — with
 * `pnpm merge:when-green <N>` only for an intentionally-separate tail and raw
 * `gh pr merge` confined to the documented recovery / bot-branch exception.
 *
 * Root cause this locks down: during PR #1301 closeout AGENTS.md §4 LED with
 * raw `gh pr merge <N> --squash --delete-branch`. Followed from a linked
 * worktree, the remote squash-merge succeeded while the local `--delete-branch`
 * cleanup failed (`main` already checked out in the primary tree). The guard
 * asserts positive invariants + ORDER (main-tree requirement precedes the
 * command; the guarded command precedes any raw-merge mention), not a blocklist
 * of phrasings — `gh pr merge` legitimately appears in the exception clause.
 *
 * Platform-agnostic: every path resolves relative to `import.meta.url`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");

const AGENTS_MD = readFileSync(resolve(REPO_ROOT, "AGENTS.md"), "utf8");
const REPO_CONVENTIONS = readFileSync(
  resolve(REPO_ROOT, ".claude", "rules", "repo-conventions.md"),
  "utf8",
);
const SKILL = readFileSync(
  resolve(
    REPO_ROOT,
    "apps",
    "docs",
    "content",
    "skills",
    "merge-when-green",
    "SKILL.md",
  ),
  "utf8",
);

/** Slice a `## <n>. …` AGENTS.md section at the next top-level `## <digit>` heading. */
function agentsSection(md: string, n: number): string {
  const start = md.search(new RegExp(`^## ${n}\\.[^\\n]*$`, "m"));
  if (start === -1) return "";
  const rest = md.slice(start);
  const nextIdx = rest.slice(1).search(/^## \d/m);
  return nextIdx === -1 ? rest : rest.slice(0, nextIdx + 1);
}

/** Slice a markdown section by its exact heading text, to the next same-or-higher heading. */
function sectionByHeading(md: string, heading: string): string {
  const start = md.indexOf(heading);
  if (start === -1) return "";
  const rest = md.slice(start);
  const nextIdx = rest.slice(1).search(/^## /m);
  return nextIdx === -1 ? rest : rest.slice(0, nextIdx + 1);
}

/** The sentence (…`.` boundary) containing the offset — for context-qualifying a match. */
function sentenceAt(text: string, index: number): string {
  const from = text.lastIndexOf(".", index);
  const to = text.indexOf(".", index);
  return text.slice(from === -1 ? 0 : from + 1, to === -1 ? text.length : to);
}

/** Every offset at which `needle` occurs in `haystack`. */
function allIndexes(haystack: string, needle: RegExp): number[] {
  return [...haystack.matchAll(new RegExp(needle.source, "g"))].map(
    (m) => m.index ?? -1,
  );
}

describe("AGENTS.md §4 — guarded closeout command is the primary wording (#1317)", () => {
  const s4 = agentsSection(AGENTS_MD, 4);

  it("§4 exists and is non-empty", () => {
    expect(s4.length).toBeGreaterThan(0);
    expect(s4).toMatch(/Merge gate/);
  });

  it("prescribes `pnpm pr:land <N>` for the complete closeout tail", () => {
    expect(s4).toContain("pnpm pr:land <N>");
  });

  it("names `pnpm merge:when-green <N>` only as the separate-tail alternative", () => {
    expect(s4).toContain("pnpm merge:when-green <N>");
    const idx = s4.indexOf("pnpm merge:when-green <N>");
    expect(sentenceAt(s4, idx)).toMatch(/separately|separate tail/i);
  });

  it("states the MAIN-tree requirement BEFORE any merge command", () => {
    const mainTree = s4.search(/MAIN tree/);
    expect(mainTree).toBeGreaterThan(-1);
    expect(s4.search(/never from a worktree/i)).toBeGreaterThan(-1);
    const firstCommand = Math.min(
      ...[
        s4.indexOf("pnpm pr:land <N>"),
        s4.indexOf("pnpm merge:when-green <N>"),
        s4.search(/gh pr merge/),
      ].filter((i) => i > -1),
    );
    expect(mainTree).toBeLessThan(firstCommand);
  });

  it("never leads with raw `gh pr merge` — every mention is the documented exception", () => {
    const hits = allIndexes(s4, /gh pr merge/);
    const guarded = s4.indexOf("pnpm pr:land <N>");
    for (const hit of hits) {
      // guarded command comes first…
      expect(guarded).toBeGreaterThan(-1);
      expect(guarded).toBeLessThan(hit);
      // …and the raw mention is qualified as recovery / bot-branch / exception.
      expect(sentenceAt(s4, hit)).toMatch(/exception|recovery|bot|reserved/i);
    }
  });

  it("does not restate a raw squash-merge invocation as the operational command", () => {
    expect(s4).not.toMatch(/`gh pr merge <N> --squash --delete-branch`/);
  });
});

describe("repo-conventions → Branches — consistent closeout contract (#1317)", () => {
  const branches = sectionByHeading(REPO_CONVENTIONS, "## Branches");

  it("the Branches section exists", () => {
    expect(branches.length).toBeGreaterThan(0);
  });

  it("requires the MAIN tree before naming the closeout command", () => {
    const mainTree = branches.search(/MAIN tree/);
    expect(mainTree).toBeGreaterThan(-1);
    expect(mainTree).toBeLessThan(branches.indexOf("pnpm pr:land <N>"));
  });

  it("names pr:land as the entry point and merge:when-green as the separate-tail case", () => {
    expect(branches).toContain("pnpm pr:land <N>");
    expect(branches).toContain("pnpm merge:when-green <N>");
  });

  it("confines raw `gh pr merge` to the exception and cross-references the recovery home", () => {
    const hits = allIndexes(branches, /gh pr merge <N>/);
    for (const hit of hits) {
      expect(sentenceAt(branches, hit)).toMatch(/exception|recovery|bot/i);
    }
    // The recovery procedure lives in the skill; this file points, never restates.
    expect(branches).toMatch(/merge-when-green` Step 2a/);
  });
});

describe("merge-when-green SKILL.md — Step 2 order (#1317)", () => {
  it("Step 2 puts the main-tree return before the command, pr:land before merge:when-green", () => {
    const step2 = SKILL.indexOf("**Step 2 —");
    expect(step2).toBeGreaterThan(-1);
    const mainTree = SKILL.indexOf("return to the main tree FIRST", step2);
    const land = SKILL.indexOf("pnpm pr:land <N>", step2);
    const whenGreen = SKILL.indexOf("pnpm merge:when-green <N>", step2);
    expect(mainTree).toBeGreaterThan(step2);
    expect(mainTree).toBeLessThan(land);
    expect(land).toBeLessThan(whenGreen);
  });

  it("owns the single recovery procedure for a landed merge with failed local cleanup", () => {
    expect(SKILL).toMatch(/Step 2a — RECOVERY/);
    expect(SKILL).toMatch(/canonical home/i);
    expect(SKILL).toMatch(/git branch -D <branch>/);
  });

  it("marks the raw merge as the exception, not the default", () => {
    const idx = SKILL.indexOf("raw `gh pr merge <N> --squash --delete-branch`");
    expect(idx).toBeGreaterThan(-1);
    expect(sentenceAt(SKILL, idx)).toMatch(/exception/i);
  });
});

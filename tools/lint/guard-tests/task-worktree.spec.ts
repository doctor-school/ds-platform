import { describe, expect, it } from "vitest";

import {
  branchName,
  branchPrefixFromLabels,
  isSpecToken,
  nextStepsLines,
  parseSpecId,
  slugifyTitle,
  specBranchName,
  specWorktreeRelPath,
  worktreeRelPath,
} from "../../dev/task-worktree.mjs";

/**
 * Unit cover for `tools/dev/task-worktree.mjs`'s pure derivation helpers (#359).
 * The impure half (`git worktree add`, `gh issue view`) is exercised live; only
 * the slug/prefix/path derivation is unit-tested here, on the established
 * guard-test harness (imports the pure exports, never fires `main()`).
 */
describe("task-worktree slugifyTitle()", () => {
  it("drops a leading [tag], lowercases, and dashes non-alphanumerics", () => {
    expect(slugifyTitle("[tooling] task:worktree clean-start command")).toBe(
      "task-worktree-clean-start-command",
    );
  });

  it("collapses runs of separators and trims leading/trailing dashes", () => {
    expect(slugifyTitle("  Fix:  the   THING!! ")).toBe("fix-the-thing");
  });

  it("caps the slug at six words so the branch name stays short", () => {
    expect(
      slugifyTitle("one two three four five six seven eight"),
    ).toBe("one-two-three-four-five-six");
  });

  it("never returns leading or trailing dashes from a bracket-only prefix", () => {
    expect(slugifyTitle("[bug] —")).toBe("");
  });
});

describe("task-worktree branchPrefixFromLabels()", () => {
  it("maps a kind label to its branch prefix", () => {
    expect(branchPrefixFromLabels(["tooling"])).toBe("tooling");
    expect(branchPrefixFromLabels(["feature"])).toBe("feat");
    expect(branchPrefixFromLabels(["bug"])).toBe("fix");
  });

  it("maps the kind:* label family to a branch prefix (#607)", () => {
    // EARS-handler / integration Issues carry `kind:ears-handler` /
    // `kind:integration` — production feature code → `feat/`, not `chore/`
    // (the #594/#550 regression this test locks down).
    expect(branchPrefixFromLabels(["kind:ears-handler"])).toBe("feat");
    expect(branchPrefixFromLabels(["kind:integration"])).toBe("feat");
    expect(
      branchPrefixFromLabels([
        "kind:ears-handler",
        "agent-ready",
        "feature:007-event-admin-minimal",
      ]),
    ).toBe("feat");
  });

  it("ignores non-kind labels and picks the first kind it recognizes", () => {
    expect(branchPrefixFromLabels(["agent-ready", "refactor", "feature"])).toBe(
      "refactor",
    );
  });

  it("falls back to chore when no kind label is present", () => {
    expect(branchPrefixFromLabels(["agent-ready"])).toBe("chore");
    expect(branchPrefixFromLabels([])).toBe("chore");
  });
});

describe("task-worktree branchName() / worktreeRelPath()", () => {
  it("composes <prefix>/<N>-<slug>", () => {
    expect(branchName("tooling", 359, "task-worktree-detector")).toBe(
      "tooling/359-task-worktree-detector",
    );
  });

  it("uses the short numeric worktree path (Windows long-path dodge)", () => {
    expect(worktreeRelPath(359)).toBe(".claude/worktrees/359");
  });
});

describe("task-worktree nextStepsLines() (#941)", () => {
  const lines = nextStepsLines(".claude/worktrees/941");
  const text = lines.join("\n");

  it("names the worktree path in the EnterWorktree + teardown steps", () => {
    expect(text).toContain("EnterWorktree path:.claude/worktrees/941");
    expect(text).toContain("pnpm worktree:teardown .claude/worktrees/941");
  });

  it("warns UNCONDITIONALLY that the first commit fails without pnpm install (#941)", () => {
    // A fresh worktree has no node_modules → the pre-commit hook (lint-staged)
    // is missing → the FIRST COMMIT fails. The warning must be unconditional
    // (not the old "# if the task touches code" hint that was easy to skim past)
    // and name the first-commit failure explicitly.
    expect(text).toContain("BEFORE YOUR FIRST COMMIT");
    expect(text).toMatch(/pre-commit hook \(lint-staged\)/);
    expect(text).toMatch(/FIRST\s+COMMIT[^]*WILL FAIL/);
    // The install step is no longer conditionally hedged.
    expect(text).not.toContain("# if the task touches code");
  });
});

describe("task-worktree spec-form derivation (#787)", () => {
  it("routes only a literal spec-NNN positional into spec mode, never a bare number", () => {
    // A bare Issue number stays the backward-compatible Issue path.
    expect(isSpecToken("787")).toBe(false);
    expect(isSpecToken("spec-008")).toBe(true);
    expect(isSpecToken("spec-8")).toBe(true);
    expect(isSpecToken("SPEC-008")).toBe(true);
    expect(isSpecToken("spec-foo")).toBe(false);
    expect(isSpecToken(undefined)).toBe(false);
  });

  it("normalizes a spec id to the canonical 3-digit NNN", () => {
    expect(parseSpecId("008")).toBe("008");
    expect(parseSpecId("8")).toBe("008");
    expect(parseSpecId("spec-008")).toBe("008");
    expect(parseSpecId("spec-8")).toBe("008");
    expect(parseSpecId("012")).toBe("012");
    expect(parseSpecId("1234")).toBe("1234");
  });

  it("returns null for a non-spec identifier so the caller fails loud", () => {
    expect(parseSpecId("portal-shell")).toBeNull();
    expect(parseSpecId("spec-")).toBeNull();
    expect(parseSpecId("")).toBeNull();
    expect(parseSpecId(undefined)).toBeNull();
  });

  it("derives the .claude/worktrees/spec-NNN path (mirrors teardown vocabulary)", () => {
    expect(specWorktreeRelPath("008")).toBe(".claude/worktrees/spec-008");
  });

  it("derives the feat/spec-NNN-<slug> branch shape", () => {
    expect(specBranchName("008", "portal-shell")).toBe(
      "feat/spec-008-portal-shell",
    );
  });
});

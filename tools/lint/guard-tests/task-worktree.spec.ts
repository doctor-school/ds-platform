import { describe, expect, it } from "vitest";

import {
  branchName,
  branchPrefixFromLabels,
  slugifyTitle,
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

import { describe, expect, it } from "vitest";

import { resolveWorktreePath } from "../../dev/worktree-teardown.mjs";

/**
 * Unit cover for `tools/dev/worktree-teardown.mjs`'s pure name-resolution helper
 * (#598). The impure half (`git worktree remove`, the long-path purge) is
 * exercised live; only the bare-name → `.claude/worktrees/<name>` resolution is
 * unit-tested here, on the established guard-test harness (imports the pure
 * export, never fires `main()` — the IS_ENTRY guard blocks it).
 *
 * `exists` is injected so no real filesystem is touched; `root` is a POSIX
 * fixture path. Assertions normalize separators (Windows `path.join` yields
 * `\`) so the test is platform-agnostic.
 */
const ROOT = "/repo";
const norm = (p: string) => p.replace(/\\/g, "/");

describe("worktree-teardown resolveWorktreePath()", () => {
  it("resolves a bare name against the primary tree's .claude/worktrees/<name>", () => {
    // Mirrors the retro scenario: a bare slug fired from inside another worktree
    // must target the primary tree, not the current cwd.
    const existsUnderRoot = (p: string) =>
      norm(p) === "/repo/.claude/worktrees/spec-006";
    expect(norm(resolveWorktreePath("spec-006", ROOT, existsUnderRoot))).toBe(
      "/repo/.claude/worktrees/spec-006",
    );
  });

  it("resolves a bare numeric name the same way", () => {
    const existsUnderRoot = (p: string) =>
      norm(p) === "/repo/.claude/worktrees/598";
    expect(norm(resolveWorktreePath("598", ROOT, existsUnderRoot))).toBe(
      "/repo/.claude/worktrees/598",
    );
  });

  it("honors an explicit relative path as-given (never rewrites .claude/worktrees paths)", () => {
    // Contains a separator → treated as a path, resolved against cwd, and the
    // `.claude/worktrees/<name>` candidate is never consulted.
    const never = () => {
      throw new Error("exists() must not be called for an explicit path");
    };
    const resolved = norm(
      resolveWorktreePath(".claude/worktrees/598", ROOT, never),
    );
    expect(resolved.endsWith("/.claude/worktrees/598")).toBe(true);
  });

  it("honors an absolute path as-given", () => {
    const never = () => {
      throw new Error("exists() must not be called for an absolute path");
    };
    // endsWith (not toBe) so a Windows drive-letter prefix from resolve() is ok.
    const abs = "/some/other/tree/wt";
    expect(norm(resolveWorktreePath(abs, ROOT, never)).endsWith(abs)).toBe(
      true,
    );
  });

  it("falls back to path-as-given when a bare name has nothing under .claude/worktrees", () => {
    const resolved = norm(resolveWorktreePath("ghost", ROOT, () => false));
    // Resolved against cwd, NOT the /repo/.claude/worktrees candidate.
    expect(resolved).not.toBe("/repo/.claude/worktrees/ghost");
    expect(resolved.endsWith("/ghost")).toBe(true);
  });

  it("falls back to path-as-given for a bare name when the repo root is unresolvable", () => {
    // root=null → the .claude/worktrees candidate can't be built, even though
    // exists() would say yes; resolve against cwd instead.
    const resolved = norm(resolveWorktreePath("spec-006", null, () => true));
    expect(resolved).not.toBe("/repo/.claude/worktrees/spec-006");
    expect(resolved.endsWith("/spec-006")).toBe(true);
  });
});

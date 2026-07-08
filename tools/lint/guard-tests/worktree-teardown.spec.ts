import { describe, expect, it } from "vitest";

import {
  classifyTeardownTarget,
  resolveWorktreePath,
} from "../../dev/worktree-teardown.mjs";

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

/**
 * Unit cover for the fail-loud classifier (#603). A teardown target is one of:
 *   "registered"   — a live worktree in `git worktree list` (normal teardown),
 *   "orphan"       — deregistered but a directory still on disk (long-path case),
 *   "unresolvable" — neither registered nor present (mangled path / typo slug),
 *                    which MUST fail non-zero instead of masquerading as clean.
 * `registeredPaths` + `exists` are injected so no git subprocess / real FS runs.
 */
describe("worktree-teardown classifyTeardownTarget()", () => {
  const REG = "/repo/.claude/worktrees/603";

  it("classifies an unresolvable target (the mangled-path retro bug) as unresolvable", () => {
    // The retro scenario: backslashes eaten by the shell → a path that is
    // neither registered nor a real directory. Previous behavior: exit 0.
    const mangled = "/cwd/C:Userssidorreposds-platform.claudeworktrees598";
    expect(classifyTeardownTarget(mangled, [REG], () => false)).toBe(
      "unresolvable",
    );
  });

  it("classifies a typo slug (nothing on disk, not registered) as unresolvable", () => {
    expect(
      classifyTeardownTarget(
        "/repo/.claude/worktrees/ghost",
        [REG],
        () => false,
      ),
    ).toBe("unresolvable");
  });

  it("classifies a registered worktree path as registered", () => {
    expect(classifyTeardownTarget(REG, [REG], () => false)).toBe("registered");
  });

  it("classifies a deregistered-but-present orphan dir as orphan (long-path case keeps exit 0)", () => {
    // Not in the registered list, but the directory is still on disk.
    expect(
      classifyTeardownTarget("/repo/.claude/worktrees/598", [REG], () => true),
    ).toBe("orphan");
  });

  it("registered takes precedence over a present directory", () => {
    expect(classifyTeardownTarget(REG, [REG], () => true)).toBe("registered");
  });

  it("matches the registered list case-insensitively and across separators", () => {
    // git worktree list yields forward slashes; resolve() on Windows yields
    // backslashes + a drive-letter case that may differ — norm() bridges both.
    const absWin = "C:\\Repo\\.claude\\worktrees\\603";
    const registeredPosix = "c:/repo/.claude/worktrees/603";
    expect(classifyTeardownTarget(absWin, [registeredPosix], () => false)).toBe(
      "registered",
    );
  });
});

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { dirtyEntriesFromTeardown, stageRemedy } from "../../gh/pr-land.mjs";
import {
  DIRTY_EXIT,
  DIRTY_LINE_PREFIX,
  isPathMangledFailure,
  longPathForm,
  longPathPurgeCommand,
  parseDirtyEntries,
  statusScanIncomplete,
  worktreeDirtyEntries,
} from "../../dev/worktree-teardown.mjs";

/**
 * Guard cover for the two #1454 defects in `tools/dev/worktree-teardown.mjs`:
 *
 *   1. the long-path purge passed the `\\?\` path as its own UNQUOTED argv
 *      element, so cmd re-parsed and mangled the prefix and EVERY >260-char
 *      worktree failed to delete (fired live on worktrees 1450 and 1435) — and
 *      the tool then misreported that path-syntax failure as an undetectable
 *      file handle,
 *   2. neither `worktree:teardown` nor `pr:land`'s teardown stage looked at
 *      `git status --porcelain`, so uncommitted work in the torn-down tree was
 *      destroyed silently.
 *
 * CI is Linux, so the COMMAND CONSTRUCTION and every classifier are asserted
 * cross-platform; the actual `cmd.exe` removal of a >260-char tree runs behind
 * a `win32` guard. The dirty-tree gate is exercised end-to-end on both
 * platforms against a throwaway git repo under `os.tmpdir()` — no drive-letter
 * literals anywhere, roots come from `import.meta.url` / `os.tmpdir()`.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const TEARDOWN = join("tools", "dev", "worktree-teardown.mjs");
const cleanups: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(dir);
  return dir;
}

afterEach(() => {
  while (cleanups.length > 0) {
    const dir = cleanups.pop();
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

describe("worktree-teardown long-path purge command (#1454)", () => {
  it("prefixes the absolute path with the \\\\?\\ long-path form", () => {
    const long = longPathForm("C:/deep/tree/worktrees/1450");
    expect(long.startsWith("\\\\?\\")).toBe(true);
    expect(long.endsWith("1450")).toBe(true);
  });

  it("never double-prefixes an already-long path and strips a trailing separator", () => {
    const once = longPathForm("C:/deep/tree/");
    expect(longPathForm(once)).toBe(once);
    // A trailing backslash would escape the closing quote in the command string.
    expect(once.endsWith("\\")).toBe(false);
    expect(once.endsWith("/")).toBe(false);
  });

  it("passes the long path QUOTED inside ONE cmd command string, never as a bare argv element", () => {
    const target = "C:/repo/.claude/worktrees/1450";
    const long = longPathForm(target);
    const { command, args, verbatim } = longPathPurgeCommand(target);

    expect(command).toBe("cmd.exe");
    // /d /s /c + exactly one command string — the regression: the old form was
    // ["/c","rmdir","/s","/q",<long path>], five argv elements cmd re-parsed.
    expect(args).toHaveLength(4);
    expect(args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(args).not.toContain(long);
    expect(args[3]).toBe(`rd /s /q "${long}"`);
    // `cmd /s` only strips outer quotes when the string STARTS with one.
    expect(args[3].startsWith('"')).toBe(false);
    // windowsVerbatimArguments — node must not re-escape the built string.
    expect(verbatim).toBe(true);
  });

  it("quotes a path containing spaces as a single argument", () => {
    const { args } = longPathPurgeCommand("C:/my repo/.claude/worktrees/99");
    expect(args[3]).toMatch(/^rd \/s \/q ".+"$/);
    expect(args).toHaveLength(4);
  });
});

describe("worktree-teardown purge-failure classification (#1454)", () => {
  it("recognizes cmd path-syntax failures as mangling, not a held handle", () => {
    expect(
      isPathMangledFailure(
        "rd: The filename, directory name, or volume label syntax is incorrect.",
      ),
    ).toBe(true);
    expect(isPathMangledFailure("rd: The network path was not found.")).toBe(
      true,
    );
    expect(isPathMangledFailure("Invalid switch - /q")).toBe(true);
  });

  it("does NOT classify a genuine held-handle failure as mangling", () => {
    expect(
      isPathMangledFailure(
        "The process cannot access the file because it is being used by another process.",
      ),
    ).toBe(false);
    expect(isPathMangledFailure("")).toBe(false);
    expect(isPathMangledFailure(undefined as unknown as string)).toBe(false);
  });
});

describe("worktree-teardown dirty-tree parsing (#1454)", () => {
  it("keeps every porcelain entry, untracked included, and drops blank lines", () => {
    const entries = parseDirtyEntries(" M tools/a.ts\n?? scratch/b.txt\n\n");
    expect(entries).toEqual([" M tools/a.ts", "?? scratch/b.txt"]);
  });

  it("reports null for a path that is not a git worktree (orphan dir has nothing to protect)", () => {
    expect(
      worktreeDirtyEntries("/nowhere", () => ({ status: 128, stdout: "" })),
    ).toBe(null);
  });

  it("reports an empty list for a clean worktree", () => {
    expect(
      worktreeDirtyEntries("/wt", () => ({ status: 0, stdout: "" })),
    ).toEqual([]);
  });

  it("flags a status scan git could not complete (long-path subtree)", () => {
    // git exits 0 but reports NOTHING for an unwalkable subtree, so the dirty
    // verdict is a floor — the teardown must say so rather than imply "clean".
    expect(
      statusScanIncomplete(
        "warning: could not open directory 'a/b/c/': Filename too long",
      ),
    ).toBe(true);
    expect(statusScanIncomplete("")).toBe(false);
    expect(statusScanIncomplete(undefined as unknown as string)).toBe(false);
  });
});

describe("pr:land surfaces the teardown refusal (#1454)", () => {
  it("lifts the dirty file list out of the teardown's captured output", () => {
    const output = [
      "[worktree-teardown] no processes reference the worktree — nothing to kill.",
      `[worktree-teardown] ${DIRTY_LINE_PREFIX} M tools/a.ts`,
      `[worktree-teardown] ${DIRTY_LINE_PREFIX}?? scratch/b.txt`,
    ].join("\n");
    expect(dirtyEntriesFromTeardown(output)).toEqual([
      "M tools/a.ts",
      "?? scratch/b.txt",
    ]);
  });

  it("returns no entries when the teardown failed for another reason", () => {
    expect(
      dirtyEntriesFromTeardown("[worktree-teardown] FOREIGN holder pid=42"),
    ).toEqual([]);
  });

  it("names the dirty-refusal exit code and the --force override in the stage remedy", () => {
    const remedy = stageRemedy("teardown", 1454);
    expect(remedy).toContain(String(DIRTY_EXIT));
    expect(remedy).toContain("--force");
  });
});

/** A throwaway git repo + linked worktree under os.tmpdir(). */
function makeFixtureWorktree(): { repo: string; worktree: string } {
  const repo = tempDir("wt-dirty-repo-");
  const git = (args: string[], cwd = repo) => {
    const res = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (res.status !== 0)
      throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  };
  git(["init", "--quiet", "-b", "main", "."]);
  git(["config", "user.email", "guard@example.test"]);
  git(["config", "user.name", "guard"]);
  writeFileSync(join(repo, "seed.txt"), "seed\n");
  git(["add", "seed.txt"]);
  git(["commit", "--quiet", "-m", "seed"]);
  const worktree = join(repo, "wt");
  git(["worktree", "add", "--quiet", "-b", "guard-fixture", worktree]);
  return { repo, worktree };
}

function runTeardown(target: string, extra: string[] = []) {
  return spawnSync("node", [TEARDOWN, target, ...extra], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

describe("worktree-teardown refuses a dirty worktree (#1454)", () => {
  it(`exits ${DIRTY_EXIT} listing the uncommitted files, and destroys nothing`, () => {
    const { worktree } = makeFixtureWorktree();
    writeFileSync(join(worktree, "seed.txt"), "edited\n");
    writeFileSync(join(worktree, "untracked.txt"), "scratch\n");

    const res = runTeardown(worktree, ["--keep-branch"]);
    const output = `${res.stdout}\n${res.stderr}`;

    expect(res.status).toBe(DIRTY_EXIT);
    expect(dirtyEntriesFromTeardown(output).join("\n")).toContain("seed.txt");
    expect(dirtyEntriesFromTeardown(output).join("\n")).toContain(
      "untracked.txt",
    );
    expect(output).toContain("--force");
    // Nothing was touched: the tree and both files are still there.
    expect(existsSync(join(worktree, "seed.txt"))).toBe(true);
    expect(existsSync(join(worktree, "untracked.txt"))).toBe(true);
  });

  it("proceeds with --force and removes the tree", () => {
    const { worktree } = makeFixtureWorktree();
    writeFileSync(join(worktree, "untracked.txt"), "scratch\n");

    const res = runTeardown(worktree, ["--force", "--keep-branch"]);

    expect(res.status).toBe(0);
    expect(`${res.stdout}\n${res.stderr}`).toContain("--force");
    expect(existsSync(worktree)).toBe(false);
  });

  it("tears a CLEAN worktree down without the gate firing", () => {
    const { worktree } = makeFixtureWorktree();

    const res = runTeardown(worktree, ["--keep-branch"]);

    expect(res.status).toBe(0);
    expect(res.stdout).not.toContain(DIRTY_LINE_PREFIX);
    expect(existsSync(worktree)).toBe(false);
  });
});

describe.runIf(process.platform === "win32")(
  "worktree-teardown purges a >260-char tree in one shot (#1454, Windows)",
  () => {
    it("removes a directory whose nested path exceeds MAX_PATH", () => {
      const root = tempDir("wt-longpath-");
      // Nest until the deepest path is comfortably past 260 chars.
      let deepest = root;
      while (deepest.length < 300) {
        deepest = join(deepest, "abcdefghijklmnopqrstuvwxyz0123456789");
      }
      mkdirSync(deepest, { recursive: true });
      writeFileSync(join(deepest, "leaf.txt"), "leaf\n");
      expect(deepest.length).toBeGreaterThan(260);

      const { command, args, verbatim } = longPathPurgeCommand(root);
      const res = spawnSync(command, args, {
        encoding: "utf8",
        windowsVerbatimArguments: verbatim,
      });

      expect(`${res.stdout ?? ""}${res.stderr ?? ""}`.trim()).toBe("");
      expect(existsSync(root)).toBe(false);
    });
  },
);

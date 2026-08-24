import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The hook is plain ESM JS (runs under bare `node` from settings.json), so the
// spec imports its pure seams directly — same construct as
// `main-tree-read-guard.spec.ts`.
import {
  classifyWritePath,
  enterWorktreeArg,
  gitWorktreeRoots,
  mainTreeEscapeMessage,
  owningRoot,
  worktreeRootOfPath,
  wrongWorktreeMessage,
} from "../../hooks/worktree-path-guard.mjs";

/**
 * Unit cover for the #1453 wrong-worktree verdict: a write aimed at ANOTHER
 * registered worktree must NOT be reported as a main-tree escape — that false
 * label pushed a dispatched agent (stale inherited cwd) into the banned
 * author-in-scratchpad-and-copy workaround. The true main-tree escape
 * (#359/#486) keeps its original wording and BLOCK.
 *
 * Paths derive from `os.tmpdir()` + `path.join` so the spec runs identically on
 * Windows and the Linux CI runner — a hardcoded drive-letter literal is a
 * RELATIVE segment to POSIX `path.resolve` and broke the `unit` job before.
 * `git` is an injected seam, so no process is ever spawned.
 */

const MAIN = resolve(tmpdir(), "fake-ds-root");
const WT = (n: string) => join(MAIN, ".claude", "worktrees", n);
const SELF = WT("1453");
const OTHER = WT("1435");
const ROOTS = [MAIN, SELF, OTHER];

const classify = (target: string, roots: string[] = ROOTS) =>
  classifyWritePath({
    target,
    mainRoot: MAIN,
    worktreeRoot: SELF,
    roots,
  });

describe("worktree-path-guard classifyWritePath() — #1453", () => {
  it("allows a write inside the session's OWN worktree", () => {
    expect(classify(join(SELF, "tools", "hooks", "x.mjs")).verdict).toBe("ok");
  });

  it("allows a write outside the repo entirely (scratchpad, temp files)", () => {
    expect(classify(resolve(tmpdir(), "scratch", "note.md")).verdict).toBe("ok");
  });

  it("flags a write into a DIFFERENT worktree as wrong-worktree, naming it", () => {
    const d = classify(join(OTHER, "apps", "docs", "spec.md"));
    expect(d.verdict).toBe("wrong-worktree");
    expect(d.targetRoot).toBe(OTHER);
  });

  it("marks a registered target worktree as registered", () => {
    expect(classify(join(OTHER, "a.md")).registered).toBe(true);
  });

  it("still classifies a foreign worktree by path shape when git is unavailable", () => {
    const d = classify(join(OTHER, "apps", "docs", "spec.md"), []);
    expect(d.verdict).toBe("wrong-worktree");
    expect(d.targetRoot).toBe(worktreeRootOfPath(OTHER));
    expect(d.registered).toBe(false);
  });

  it("keeps the wrong-worktree verdict for a TORN-DOWN worktree path", () => {
    // The retro case: cwd pinned to a worktree, target under a checkout git no
    // longer lists. Still not a main-tree escape.
    const gone = WT("1450");
    const d = classify(join(gone, "notes.md"));
    expect(d.verdict).toBe("wrong-worktree");
    expect(d.registered).toBe(false);
  });

  it("BLOCKS a true main-tree escape as main-tree-escape", () => {
    expect(classify(join(MAIN, "tools", "agent-bootstrap.ts")).verdict).toBe(
      "main-tree-escape",
    );
  });

  it("BLOCKS a main-tree escape into .claude/ outside the worktrees dir", () => {
    expect(classify(join(MAIN, ".claude", "settings.json")).verdict).toBe(
      "main-tree-escape",
    );
  });
});

describe("worktree-path-guard messages", () => {
  const target = join(OTHER, "apps", "docs", "spec.md");

  it("prescribes exactly EnterWorktree path:<target worktree>", () => {
    const msg = wrongWorktreeMessage(target, OTHER, SELF);
    expect(msg).toContain("wrong-worktree");
    expect(msg).toContain("EnterWorktree path:.claude/worktrees/1435");
    expect(msg).toContain(OTHER);
  });

  it("never labels a cross-worktree write a main-tree escape", () => {
    const msg = wrongWorktreeMessage(target, OTHER, SELF);
    expect(msg).toContain("NOT a main-tree escape");
    expect(msg).not.toContain("targets the SHARED main tree");
  });

  it("names the scratchpad-and-copy workaround as banned", () => {
    expect(wrongWorktreeMessage(target, OTHER, SELF)).toContain(
      "Do NOT author the file elsewhere",
    );
  });

  it("points at pnpm task:worktree when the target worktree is not registered", () => {
    const msg = wrongWorktreeMessage(target, OTHER, SELF, false);
    expect(msg).toContain("NOT registered");
    expect(msg).toContain("pnpm task:worktree <N>");
    expect(wrongWorktreeMessage(target, OTHER, SELF, true)).not.toContain(
      "NOT registered",
    );
  });

  it("keeps the original main-tree-escape wording", () => {
    const msg = mainTreeEscapeMessage(
      join(MAIN, "tools", "agent-bootstrap.ts"),
      MAIN,
      SELF,
    );
    expect(msg).toContain("targets the SHARED main tree");
    expect(msg).toContain("feedback_worktree_absolute_paths_escape_isolation");
    expect(msg).toContain("Use the worktree path instead");
    expect(msg).not.toContain("wrong-worktree");
  });

  it("falls back to the absolute root when the checkout is not under .claude/worktrees", () => {
    const external = resolve(tmpdir(), "elsewhere", "checkout");
    expect(enterWorktreeArg(external)).toBe(external);
    expect(enterWorktreeArg(OTHER)).toBe(".claude/worktrees/1435");
  });
});

describe("worktree-path-guard owningRoot() / gitWorktreeRoots()", () => {
  it("picks the LONGEST containing root (worktree wins over the main tree)", () => {
    expect(owningRoot(join(SELF, "a", "b.ts"), ROOTS)).toBe(SELF);
    expect(owningRoot(join(MAIN, "a", "b.ts"), ROOTS)).toBe(MAIN);
    expect(owningRoot(resolve(tmpdir(), "nope", "b.ts"), ROOTS)).toBe("");
  });

  it("parses `git worktree list --porcelain` into absolute roots", () => {
    const porcelain = [
      `worktree ${MAIN}`,
      "HEAD 1111111111111111111111111111111111111111",
      "branch refs/heads/main",
      "",
      `worktree ${SELF}`,
      "HEAD 2222222222222222222222222222222222222222",
      "branch refs/heads/tooling/1453-x",
      "",
    ].join("\n");
    expect(gitWorktreeRoots(MAIN, () => porcelain)).toEqual([MAIN, SELF]);
  });

  it("fails open to [] when git cannot be run", () => {
    expect(
      gitWorktreeRoots(MAIN, () => {
        throw new Error("git missing");
      }),
    ).toEqual([]);
  });
});

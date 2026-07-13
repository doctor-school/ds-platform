import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The hook is plain ESM JS (runs under bare `node` from settings.json), so the
// spec imports its pure seams directly — same pattern as the bootstrap spec.
import {
  FLAG_REL,
  FRESH_WINDOW_MS,
  decideWarn,
  inWorktree,
  targetPath,
  warnMessage,
} from "../../hooks/main-tree-read-guard.mjs";
import {
  PARALLEL_FLAG_REL,
  buildParallelFlag,
  mainTreeIsolationDirective,
} from "../../agent-bootstrap";

/**
 * Unit cover for the #823 main-tree-read guard: bootstrap drops a
 * machine-readable parallel-sessions flag; the PreToolUse hook consults it and
 * WARNS (never blocks) on Read/Grep/Glob of repo source in the SHARED main
 * tree until the session enters a worktree.
 *
 * Paths are derived from `os.tmpdir()` + `path.resolve`/`join` so the spec
 * runs identically on Windows and the Linux CI runner — a hardcoded
 * drive-letter literal is a RELATIVE segment to POSIX `path.resolve` and broke
 * the `unit` job. The stat probe is an injected seam, so no fixture files are
 * created on disk.
 */

const ROOT = resolve(tmpdir(), "fake-ds-root");
const LOGS = resolve(tmpdir(), "fake-claude-logs");
const NOW = 1_000_000_000_000;

const flagWith = (sessions: Array<{ id: string; logPath: string }>) => ({
  generatedAt: new Date(NOW).toISOString(),
  liveSessions: sessions.length,
  liveInMainTree: sessions.length,
  sessions: sessions.map((s) => ({ ...s, inSharedMainTree: true })),
});

/** stat seam: every listed log looks freshly touched. */
const freshStat = () => NOW - 1_000;
/** stat seam: every listed log is stale (session ended long ago). */
const staleStat = () => NOW - FRESH_WINDOW_MS - 1_000;

const base = {
  toolName: "Read",
  toolInput: { file_path: join(ROOT, "tools", "agent-bootstrap.ts") },
  cwd: ROOT,
  sessionId: "self",
  projectDir: ROOT,
  flag: flagWith([{ id: "peer", logPath: join(LOGS, "peer.jsonl") }]),
  statMtimeMs: freshStat,
  nowMs: NOW,
};

describe("main-tree-read-guard decideWarn()", () => {
  it("warns on a main-tree source Read while a foreign session is live", () => {
    const d = decideWarn({ ...base });
    expect(d.warn).toBe(true);
    expect(d.liveCount).toBe(1);
  });

  it("names pnpm task:worktree <N> in the warning", () => {
    expect(warnMessage(2)).toContain("pnpm task:worktree <N>");
    expect(warnMessage(2)).toContain("EnterWorktree");
  });

  it("stays silent when there is no flag (no parallel sessions at bootstrap)", () => {
    expect(decideWarn({ ...base, flag: null }).warn).toBe(false);
  });

  it("stays silent when every flagged session's log has gone stale", () => {
    expect(decideWarn({ ...base, statMtimeMs: staleStat }).warn).toBe(false);
  });

  it("stays silent when the only flagged session is this session itself", () => {
    const flag = flagWith([{ id: "self", logPath: join(LOGS, "self.jsonl") }]);
    expect(decideWarn({ ...base, flag }).warn).toBe(false);
  });

  it("stays silent after the session enters a worktree (cwd cleared)", () => {
    const cwd = join(ROOT, ".claude", "worktrees", "823");
    expect(decideWarn({ ...base, cwd }).warn).toBe(false);
  });

  it("stays silent for a session born in a worktree (projectDir cleared)", () => {
    const projectDir = join(ROOT, ".claude", "worktrees", "770");
    expect(decideWarn({ ...base, projectDir }).warn).toBe(false);
  });

  it("ignores non-read tools", () => {
    expect(decideWarn({ ...base, toolName: "Bash" }).warn).toBe(false);
    expect(decideWarn({ ...base, toolName: "Edit" }).warn).toBe(false);
  });

  it("ignores targets outside the repo (scratchpad, auto-memory)", () => {
    const toolInput = {
      file_path: resolve(tmpdir(), "outside-repo", "memory", "MEMORY.md"),
    };
    expect(decideWarn({ ...base, toolInput }).warn).toBe(false);
  });

  it("ignores the repo's own .claude/ and .git/ plumbing", () => {
    for (const p of [
      join(ROOT, ".claude", "settings.json"),
      join(ROOT, ".git", "HEAD"),
    ]) {
      expect(decideWarn({ ...base, toolInput: { file_path: p } }).warn).toBe(
        false,
      );
    }
  });

  it("warns on a Grep/Glob whose path defaults to the main-tree cwd", () => {
    const d = decideWarn({ ...base, toolName: "Grep", toolInput: {} });
    expect(d.warn).toBe(true);
  });

  it("counts only live foreign sessions in liveCount", () => {
    const flag = flagWith([
      { id: "peer-a", logPath: join(LOGS, "a.jsonl") },
      { id: "peer-b", logPath: join(LOGS, "b.jsonl") },
      { id: "self", logPath: join(LOGS, "self.jsonl") },
    ]);
    const d = decideWarn({ ...base, flag });
    expect(d.warn).toBe(true);
    expect(d.liveCount).toBe(2);
  });
});

describe("main-tree-read-guard path seams", () => {
  it("targetPath resolves a relative path against the cwd", () => {
    expect(targetPath({ path: "tools" }, ROOT)).toBe(resolve(ROOT, "tools"));
  });

  it("targetPath keeps an absolute path as-is", () => {
    const abs = join(ROOT, "tools", "x.ts");
    expect(targetPath({ file_path: abs }, resolve(tmpdir(), "elsewhere"))).toBe(
      abs,
    );
  });

  it("targetPath falls back to the cwd when no path is given", () => {
    expect(targetPath({}, ROOT)).toBe(ROOT);
    expect(targetPath(undefined, ROOT)).toBe(ROOT);
  });

  it("inWorktree matches the worktree root itself and its children", () => {
    expect(inWorktree(join(ROOT, ".claude", "worktrees", "823"))).toBe(true);
    expect(inWorktree(join(ROOT, ".claude", "worktrees", "823", "tools"))).toBe(
      true,
    );
    expect(inWorktree(ROOT)).toBe(false);
  });

  it("inWorktree normalizes backslash separators (Windows payloads)", () => {
    // Literal backslash STRINGS (not fed through path.resolve) — exercises the
    // hook's own separator normalization regardless of the host platform.
    expect(inWorktree("X:\\repo\\.claude\\worktrees\\9")).toBe(true);
    expect(inWorktree("X:\\repo")).toBe(false);
  });
});

describe("bootstrap flag + directive (#823)", () => {
  it("hook and bootstrap agree on the flag path (single well-known path)", () => {
    expect(FLAG_REL).toBe(PARALLEL_FLAG_REL);
  });

  it("buildParallelFlag carries the session list + timestamp", () => {
    const logPath = join(LOGS, "peer.jsonl");
    const flag = buildParallelFlag(
      [{ id: "peer", mtimeMs: NOW, inSharedMainTree: true, logPath }],
      "2026-07-13T00:00:00.000Z",
    );
    expect(flag.generatedAt).toBe("2026-07-13T00:00:00.000Z");
    expect(flag.liveSessions).toBe(1);
    expect(flag.liveInMainTree).toBe(1);
    expect(flag.sessions).toEqual([
      { id: "peer", logPath, inSharedMainTree: true },
    ]);
  });

  it("directive is imperative and names the isolation command", () => {
    const d = mainTreeIsolationDirective(2);
    expect(d).toContain("FIRST ACTION");
    expect(d).toContain("pnpm task:worktree <N>");
    expect(d).toContain("EnterWorktree path:.claude/worktrees/<N>");
    expect(d).not.toMatch(/^> ⚠/);
  });
});

import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The hook is plain ESM JS (runs under bare `node` from settings.json), so the
// spec imports its pure seams directly — same pattern as the bootstrap spec.
import {
  FLAG_REL,
  FRESH_WINDOW_MS,
  GUARD_STATE_DIR_REL,
  decideReadAction,
  decideWarn,
  inWorktree,
  readState,
  softenedNoticeMessage,
  stateFilePath,
  targetPath,
  warnMessage,
  writeState,
} from "../../hooks/main-tree-read-guard.mjs";
import {
  decideWriteWarn,
  writeWarnMessage,
} from "../../hooks/worktree-path-guard.mjs";
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

/**
 * #854 read-only orchestration carve-out: a read-only lead (zero main-tree
 * writes) sees ONE softened notice instead of a per-read warning; the first
 * main-tree WRITE re-arms the full guard. State is injected — the pure seams are
 * exercised without touching a real `.claude/` state file.
 */
describe("main-tree-read-guard decideReadAction() — #854 carve-out", () => {
  const warned = { warn: true as const, liveCount: 2 };
  const notWarned = { warn: false as const };

  it("stays silent when the underlying warn conditions don't hold", () => {
    expect(decideReadAction({ warnDecision: notWarned, state: {} }).action).toBe(
      "silent",
    );
  });

  it("(a) first read, zero writes → one softened notice + flags noticeShown", () => {
    const a = decideReadAction({
      warnDecision: warned,
      state: { noticeShown: false, mainTreeWriteSeen: false },
    });
    expect(a.action).toBe("notice");
    expect(a.liveCount).toBe(2);
    expect(a.setNoticeShown).toBe(true);
  });

  it("(b) second read, notice already shown, no write → silent", () => {
    const b = decideReadAction({
      warnDecision: warned,
      state: { noticeShown: true, mainTreeWriteSeen: false },
    });
    expect(b.action).toBe("silent");
  });

  it("(c) read after a main-tree write → FULL warning, not the notice", () => {
    const c = decideReadAction({
      warnDecision: warned,
      state: { noticeShown: true, mainTreeWriteSeen: true },
    });
    expect(c.action).toBe("warn");
    expect(c.liveCount).toBe(2);
  });

  it("a write seen before any notice still forces the full warning", () => {
    const d = decideReadAction({
      warnDecision: warned,
      state: { noticeShown: false, mainTreeWriteSeen: true },
    });
    expect(d.action).toBe("warn");
  });

  it("tolerates a missing/partial state object (fail-open → notice)", () => {
    expect(decideReadAction({ warnDecision: warned }).action).toBe("notice");
  });

  it("the softened notice is a single line naming the carve-out + write reset", () => {
    const msg = softenedNoticeMessage(3);
    expect(msg).toContain("carve-out");
    expect(msg).toMatch(/first main-tree WRITE/i);
    expect(msg).not.toContain("\n");
  });
});

describe("main-tree guard state seam (#854)", () => {
  it("stateFilePath sanitizes the session id and lives under the gitignored dir", () => {
    const p = stateFilePath(ROOT, "sess/../evil id");
    expect(p).toBe(
      join(ROOT, ...GUARD_STATE_DIR_REL.split("/"), "sess_.._evil_id.json"),
    );
  });

  it("readState fails open to both-false on a missing/corrupt file", () => {
    const bad = () => {
      throw new Error("ENOENT");
    };
    expect(readState("nope", bad)).toEqual({
      noticeShown: false,
      mainTreeWriteSeen: false,
    });
    expect(readState("bad", () => "{not json")).toEqual({
      noticeShown: false,
      mainTreeWriteSeen: false,
    });
  });

  it("readState coerces truthy-but-nonboolean fields to false", () => {
    expect(
      readState("x", () => JSON.stringify({ noticeShown: 1, mainTreeWriteSeen: true })),
    ).toEqual({ noticeShown: false, mainTreeWriteSeen: true });
  });

  it("writeState mkdirs the parent then writes JSON (injected FS)", () => {
    const calls: Array<[string, string]> = [];
    const mkdirs: string[] = [];
    writeState(
      join(ROOT, ".claude", "main-tree-guard-state", "s.json"),
      { noticeShown: true, mainTreeWriteSeen: false },
      {
        mkdir: (d: string) => mkdirs.push(d),
        writeFile: (p: string, c: string) => calls.push([p, c]),
      },
    );
    expect(mkdirs).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0][1])).toEqual({
      noticeShown: true,
      mainTreeWriteSeen: false,
    });
  });

  it("writeState swallows FS errors (fail-open, never throws)", () => {
    expect(() =>
      writeState("x", { noticeShown: true, mainTreeWriteSeen: true }, {
        mkdir: () => {
          throw new Error("EACCES");
        },
        writeFile: () => undefined,
      }),
    ).not.toThrow();
  });
});

/**
 * #854 write side: the first main-tree WRITE in a shared-main-tree, parallel-
 * live, not-in-worktree session warns at full strength. Mirrors `decideWarn()`.
 */
describe("worktree-path-guard decideWriteWarn() — #854", () => {
  const wbase = {
    toolName: "Write",
    toolInput: { file_path: join(ROOT, "tools", "hooks", "x.mjs") },
    cwd: ROOT,
    sessionId: "self",
    projectDir: ROOT,
    flag: flagWith([{ id: "peer", logPath: join(LOGS, "peer.jsonl") }]),
    statMtimeMs: freshStat,
    nowMs: NOW,
  };

  it("(d) warns on the first main-tree write in a non-isolated parallel session", () => {
    const d = decideWriteWarn({ ...wbase });
    expect(d.warn).toBe(true);
    expect(d.liveCount).toBe(1);
  });

  it("warns for Edit and MultiEdit too", () => {
    expect(decideWriteWarn({ ...wbase, toolName: "Edit" }).warn).toBe(true);
    expect(decideWriteWarn({ ...wbase, toolName: "MultiEdit" }).warn).toBe(true);
  });

  it("(e) no-op once the session is inside a worktree", () => {
    const cwd = join(ROOT, ".claude", "worktrees", "854");
    expect(decideWriteWarn({ ...wbase, cwd }).warn).toBe(false);
  });

  it("(e) no-op when no parallel session is live (no flag / all stale)", () => {
    expect(decideWriteWarn({ ...wbase, flag: null }).warn).toBe(false);
    expect(decideWriteWarn({ ...wbase, statMtimeMs: staleStat }).warn).toBe(
      false,
    );
  });

  it("ignores non-write tools", () => {
    expect(decideWriteWarn({ ...wbase, toolName: "Read" }).warn).toBe(false);
  });

  it("ignores writes to .claude/ , .git/ and outside the repo", () => {
    for (const file_path of [
      join(ROOT, ".claude", "settings.json"),
      join(ROOT, ".git", "HEAD"),
      resolve(tmpdir(), "outside-repo", "note.txt"),
    ]) {
      expect(decideWriteWarn({ ...wbase, toolInput: { file_path } }).warn).toBe(
        false,
      );
    }
  });

  it("write warning names the isolation command and the ended carve-out", () => {
    const msg = writeWarnMessage(2);
    expect(msg).toContain("pnpm task:worktree <N>");
    expect(msg).toContain("carve-out");
  });
});

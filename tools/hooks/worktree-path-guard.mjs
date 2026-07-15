#!/usr/bin/env node
// PreToolUse guard on Edit/Write/MultiEdit. Two independent responsibilities:
//
// 1. Escape-BLOCK (exit 2, #359/#486): block a Write/Edit whose ABSOLUTE path
//    escapes the active git worktree back into the SHARED main tree (AGENTS.md
//    §6; memory `feedback_worktree_absolute_paths_escape_isolation`).
//    `EnterWorktree` changes the session cwd but does NOT redirect absolute
//    paths — an Edit/Write with an absolute main-tree `file_path` (carried over
//    from pre-worktree Read/Bash calls) silently writes to the main tree while a
//    parallel session may sweep it into the wrong PR, and any green observed
//    there is against the wrong checkout. Enforced at the moment the bad path is
//    issued.
//
// 2. Write-WARN (exit 0 + systemMessage, #854): the FIRST main-tree WRITE in a
//    NON-isolated session (cwd not in a worktree) while parallel sessions are
//    live fires the guard's FULL warning and records `mainTreeWriteSeen` in the
//    per-session state file. This is the write half of the #823 read-guard's
//    read-only orchestration carve-out (#854): a read-only lead sees one
//    softened notice, but the moment it edits main-tree files the full guard
//    resumes — the write itself warns, and subsequent reads warn at full
//    strength. WARN-level only — it never blocks (that is habituation, not the
//    escape hazard #1 guards).
//
// Contract: reads the PreToolUse hook JSON on stdin ({session_id, cwd,
// tool_name, tool_input:{file_path}}). Exit 2 + stderr = BLOCK. Exit 0 (+
// optional stdout systemMessage) = allow. FAIL-OPEN: any parse/logic error
// exits 0 — a guard bug must never wedge legitimate edits.

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FLAG_REL,
  FRESH_WINDOW_MS,
  inWorktree,
  isUnder,
  norm,
  readState,
  stateFilePath,
  targetPath,
  writeState,
} from "./main-tree-read-guard.mjs";

function isAbsolute(p) {
  return /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\/.test(p) || p.startsWith("/");
}

export function writeWarnMessage(liveCount) {
  return (
    `⚠ main-tree write guard (#823/#854): ${liveCount} parallel session(s) are live and ` +
    `this session is WRITING repo source in the SHARED main tree without worktree ` +
    `isolation. The read-only orchestration carve-out has ended — the full guard is now ` +
    `active. Isolate before further edits: \`pnpm task:worktree <N>\` → ` +
    `\`EnterWorktree path:.claude/worktrees/<N>\` (a parallel session can sweep an ` +
    `un-isolated edit into the wrong PR — AGENTS.md §6, #418). Warn-level only.`
  );
}

/**
 * Pure decision seam (mirrors `decideWarn()` for the read side): should a
 * main-tree WRITE warn? True only when — the tool is Edit/Write/MultiEdit, the
 * session is NOT in a worktree (cwd + projectDir both outside `.claude/
 * worktrees/`), parallel sessions are still live (freshness re-check against the
 * flag), and the target is repo SOURCE (under projectDir, not `.claude/` or
 * `.git/`). Returns `{ warn: false }` or `{ warn: true, liveCount }`.
 */
export function decideWriteWarn({
  toolName,
  toolInput,
  cwd,
  sessionId,
  projectDir,
  flag,
  statMtimeMs,
  nowMs,
  freshWindowMs = FRESH_WINDOW_MS,
}) {
  if (!/^(Edit|Write|MultiEdit)$/.test(toolName || "")) return { warn: false };
  if (!cwd || !projectDir) return { warn: false };
  // A worktree-isolated session is exactly the compliant case — never warn.
  if (inWorktree(cwd) || inWorktree(projectDir)) return { warn: false };
  if (!flag || !Array.isArray(flag.sessions)) return { warn: false };

  const live = flag.sessions.filter((s) => {
    if (!s || !s.logPath || s.id === sessionId) return false;
    const m = statMtimeMs(s.logPath);
    return m != null && nowMs - m <= freshWindowMs;
  });
  if (live.length === 0) return { warn: false };

  const target = targetPath(toolInput, cwd);
  if (!isUnder(target, projectDir)) return { warn: false };
  if (
    isUnder(target, `${projectDir}/.claude`) ||
    isUnder(target, `${projectDir}/.git`)
  ) {
    return { warn: false };
  }

  return { warn: true, liveCount: live.length };
}

function main() {
  try {
    const raw = readFileSync(0, "utf8");
    const payload = JSON.parse(raw);
    const tool = payload.tool_name || "";
    if (!/^(Edit|Write|MultiEdit)$/.test(tool)) process.exit(0);

    const cwd = payload.cwd || "";
    const filePath = payload.tool_input && payload.tool_input.file_path;

    // --- (1) Escape-BLOCK: absolute main-tree path issued from inside a worktree.
    if (cwd && filePath && isAbsolute(filePath)) {
      const m = cwd.match(/^(.*)[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)/);
      if (m) {
        const mainRoot = norm(m[1]);
        const worktreeRoot = norm(`${m[1]}/.claude/worktrees/${m[2]}`);
        const target = norm(filePath);
        const underMain =
          target === mainRoot || target.startsWith(mainRoot + "/");
        const underWorktree =
          target === worktreeRoot || target.startsWith(worktreeRoot + "/");
        if (underMain && !underWorktree) {
          process.stderr.write(
            `BLOCKED: '${filePath}' is an absolute path in the SHARED main tree, but this ` +
              `session is isolated in a worktree.\n` +
              `Escaping the worktree writes to the main tree (a parallel session can sweep ` +
              `it into the wrong PR; any green there is against the wrong checkout — ` +
              `AGENTS.md §6, memory feedback_worktree_absolute_paths_escape_isolation).\n` +
              `Use the worktree path instead: a repo-relative path, or the worktree prefix ` +
              `'${m[1]}\\.claude\\worktrees\\${m[2]}\\...'.\n`,
          );
          process.exit(2);
        }
        // In a worktree with a compliant path → isolated session, nothing to warn.
        process.exit(0);
      }
      // cwd NOT in a worktree → fall through to the write-WARN branch.
    }

    // --- (2) Write-WARN: first main-tree write in a non-isolated parallel session.
    const projectDir = process.env.CLAUDE_PROJECT_DIR || payload.cwd || "";
    let flag = null;
    try {
      flag = JSON.parse(readFileSync(resolve(projectDir, FLAG_REL), "utf8"));
    } catch {
      // No flag → bootstrap saw no parallel sessions (or never ran) → allow.
    }
    const decision = decideWriteWarn({
      toolName: tool,
      toolInput: payload.tool_input,
      cwd,
      sessionId: payload.session_id || "",
      projectDir,
      flag,
      statMtimeMs: (p) => {
        try {
          return statSync(p).mtimeMs;
        } catch {
          return null;
        }
      },
      nowMs: Date.now(),
    });
    if (decision.warn) {
      const statePath = stateFilePath(projectDir, payload.session_id || "");
      const state = readState(statePath);
      // Warn once — on the FIRST main-tree write. `mainTreeWriteSeen` then makes
      // the read guard warn at full strength for the rest of the session.
      if (!state.mainTreeWriteSeen) {
        const msg = writeWarnMessage(decision.liveCount);
        process.stdout.write(
          JSON.stringify({
            systemMessage: msg,
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "allow",
              permissionDecisionReason: msg,
            },
          }),
        );
        writeState(statePath, { ...state, mainTreeWriteSeen: true });
      }
    }
    process.exit(0);
  } catch {
    process.exit(0); // fail-open: never wedge a legitimate edit on a guard bug
  }
}

// Entry-point guard: run `main()` only when invoked directly, so the guard-tests
// spec can import the pure seams without firing stdin reads / process.exit.
const invoked = process.argv[1] ? norm(resolve(process.argv[1])) : "";
if (invoked && invoked === norm(fileURLToPath(import.meta.url))) {
  main();
}

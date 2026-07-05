#!/usr/bin/env node
// PreToolUse guard: block a Write/Edit whose absolute path escapes the active
// git worktree back into the SHARED main tree (AGENTS.md §6; memory
// `feedback_worktree_absolute_paths_escape_isolation`). `EnterWorktree` changes
// the session cwd but does NOT redirect absolute paths — an Edit/Write with an
// absolute main-tree `file_path` (carried over from the pre-worktree Read/Bash
// calls) silently writes to the main tree while a parallel session may sweep it
// into the wrong PR, and any green observed there is against the wrong checkout.
// This recurred twice (#359, #486) with only prose to prevent it, so it is now
// enforced at the exact moment the bad path is issued.
//
// Contract: reads the PreToolUse hook JSON on stdin ({cwd, tool_name, tool_input:
// {file_path}}). Exit 2 + stderr = BLOCK (the reason is fed back to the agent).
// Exit 0 = allow. FAIL-OPEN: any parse/logic error exits 0 — a guard bug must
// never wedge legitimate edits.
//
// Fires ONLY when: (1) cwd is inside `.claude/worktrees/<N>/`, AND (2) file_path
// is ABSOLUTE, AND (3) it points under the main-tree root but NOT under the
// active worktree root. Relative paths (resolve against the worktree cwd) and
// paths outside the repo entirely (auto-memory `~/.claude/...`, scratchpad/tmp)
// are always allowed.

import { readFileSync } from "node:fs";

function norm(p) {
  // Case-insensitive + separator-insensitive prefix comparison (Windows FS).
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function isAbsolute(p) {
  return /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\/.test(p) || p.startsWith("/");
}

try {
  const raw = readFileSync(0, "utf8");
  const payload = JSON.parse(raw);
  const tool = payload.tool_name || "";
  if (!/^(Edit|Write|MultiEdit)$/.test(tool)) process.exit(0);

  const cwd = payload.cwd || "";
  const filePath = payload.tool_input && payload.tool_input.file_path;
  if (!cwd || !filePath) process.exit(0);
  if (!isAbsolute(filePath)) process.exit(0); // relative → resolves under the worktree cwd

  // Is the session cwd inside a worktree? Capture the main-tree root (everything
  // before `/.claude/worktrees/`) and the active worktree root (through <N>).
  const m = cwd.match(/^(.*)[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)/);
  if (!m) process.exit(0); // not in a worktree → nothing to guard

  const mainRoot = norm(m[1]);
  const worktreeRoot = norm(`${m[1]}/.claude/worktrees/${m[2]}`);
  const target = norm(filePath);

  const underMain = target === mainRoot || target.startsWith(mainRoot + "/");
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
  process.exit(0);
} catch {
  process.exit(0); // fail-open: never wedge a legitimate edit on a guard bug
}

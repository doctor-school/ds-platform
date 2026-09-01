// Shared main-tree isolation seams (#823/#854, extracted #1700).
//
// These were the exported library half of `tools/hooks/main-tree-read-guard.mjs`.
// #1700 retired that guard: a week-long transcript audit (2026-08-25..09-01, 75
// sessions) recorded ZERO blocks from it and a warning on essentially every
// main-tree Read/Grep/Glob — the isolation contract it restated is already
// enforced at the WRITE boundary by the BLOCK-level `worktree-path-guard.mjs`,
// which is where the actual damage (uncommitted edits swept into the wrong PR)
// happens. The read-side messaging is gone; the STATE these seams describe is
// not, because the write guard still reads it. So the seams live here, in a
// module named for what they are, rather than inside a hook that no longer runs.
//
// Consumers: `tools/hooks/worktree-path-guard.mjs` (the flag + per-session
// state + path helpers) and `tools/agent-bootstrap.ts` (writes the flag —
// `PARALLEL_FLAG_REL` there MUST equal `FLAG_REL` here).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Flag file the bootstrap writes — MUST match `PARALLEL_FLAG_REL` in
 * `tools/agent-bootstrap.ts` (asserted equal by the guard-tests spec). */
export const FLAG_REL = ".claude/parallel-sessions.flag.json";

/** Per-session guard-state directory (#854). Holds one `<session_id>.json` per
 * session with `{noticeShown, mainTreeWriteSeen}`. Gitignored (machine state,
 * not repo content). */
export const GUARD_STATE_DIR_REL = ".claude/main-tree-guard-state";

/** A listed session counts as live only if its log was touched this recently —
 * same window as the bootstrap's own detector (`SESSION_WINDOW_MS`). */
export const FRESH_WINDOW_MS = 10 * 60 * 1000;

/** Case-insensitive + separator-insensitive path comparison (Windows FS). */
export function norm(p) {
  return String(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function isUnder(child, parent) {
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p + "/");
}

function isAbsolute(p) {
  return /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\/.test(p) || p.startsWith("/");
}

/** True when a path sits inside a linked worktree checkout. */
export function inWorktree(p) {
  return /\/\.claude\/worktrees(\/|$)/.test(norm(p));
}

/**
 * The path a tool call actually targets: `file_path` (Read/Edit/Write),
 * `path` (Grep/Glob), resolved against the session cwd when relative; a call
 * with no path defaults to the cwd itself.
 */
export function targetPath(toolInput, cwd) {
  const p = (toolInput && (toolInput.file_path || toolInput.path)) || "";
  if (!p) return cwd;
  return isAbsolute(p) ? p : resolve(cwd, p);
}

/** Resolve the per-session guard-state file path. `session_id` is sanitized to
 * a safe filename segment; a missing id degrades to a shared `unknown` file
 * (fail-open — never throws). */
export function stateFilePath(projectDir, sessionId) {
  const safe = String(sessionId || "unknown").replace(/[^A-Za-z0-9._-]/g, "_");
  return resolve(projectDir, GUARD_STATE_DIR_REL, `${safe}.json`);
}

/** Read `{noticeShown, mainTreeWriteSeen}` for a session. Missing/corrupt file →
 * both-false (fail-open). `readFile` is injectable for unit tests. */
export function readState(path, readFile = (p) => readFileSync(p, "utf8")) {
  try {
    const s = JSON.parse(readFile(path)) || {};
    return {
      noticeShown: s.noticeShown === true,
      mainTreeWriteSeen: s.mainTreeWriteSeen === true,
    };
  } catch {
    return { noticeShown: false, mainTreeWriteSeen: false };
  }
}

/** Persist guard state (best-effort). Any FS error is swallowed — a state-write
 * failure must NEVER block or crash a tool call. FS ops are injectable for tests. */
export function writeState(path, state, deps = {}) {
  const mkdir = deps.mkdir || ((d) => mkdirSync(d, { recursive: true }));
  const writeFile = deps.writeFile || ((p, c) => writeFileSync(p, c));
  try {
    mkdir(dirname(path));
    writeFile(path, JSON.stringify(state));
  } catch {
    // fail-open: state persistence is best-effort.
  }
}

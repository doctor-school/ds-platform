#!/usr/bin/env node
// PreToolUse guard (WARN-level, #823): a Read/Grep/Glob of a repo SOURCE path
// in the SHARED main tree while parallel sessions are live, before this session
// has entered a worktree. Analysis reads are part of the isolation contract
// (AGENTS.md §6, #418): a parallel session can advance origin/main past the
// shared-tree copy, so a design built on a dirty-main read is built on stale
// content. The bootstrap (`tools/agent-bootstrap.ts`) detects live parallel
// sessions at session start and drops a machine-readable flag file; this hook
// consults that flag on every Read/Grep/Glob and WARNS — it never blocks, so
// bootstrap-only sessions (board triage, `gh` reads) stay fully usable.
//
// Contract: reads the PreToolUse hook JSON on stdin ({session_id, cwd,
// tool_name, tool_input}). Warn = exit 0 + JSON on stdout ({systemMessage,
// hookSpecificOutput.permissionDecision:"allow"}). Silent allow = exit 0, no
// output. FAIL-OPEN: any parse/logic error exits 0 — a guard bug must never
// wedge a legitimate read.
//
// The warning clears itself deterministically:
// - worktree entered (cwd under `.claude/worktrees/<N>`, e.g. via
//   EnterWorktree) → the cwd check short-circuits;
// - no live parallel session anymore → the freshness re-check against the
//   flag's session-log mtimes short-circuits (a stale flag never warns).

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Flag file the bootstrap writes — MUST match `PARALLEL_FLAG_REL` in
 * `tools/agent-bootstrap.ts` (asserted equal by the guard-tests spec). */
export const FLAG_REL = ".claude/parallel-sessions.flag.json";

/** Per-session guard-state directory (#854). Holds one `<session_id>.json` per
 * session with `{noticeShown, mainTreeWriteSeen}`. Gitignored (machine state,
 * not repo content) — the read guard and the write guard both read/write it to
 * implement the read-only orchestration carve-out. */
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
 * The path a Read/Grep/Glob call actually targets: `file_path` (Read),
 * `path` (Grep/Glob), resolved against the session cwd when relative; a
 * Grep/Glob with no path defaults to the cwd itself.
 */
export function targetPath(toolInput, cwd) {
  const p = (toolInput && (toolInput.file_path || toolInput.path)) || "";
  if (!p) return cwd;
  return isAbsolute(p) ? p : resolve(cwd, p);
}

export function warnMessage(liveCount) {
  return (
    `⚠ main-tree read guard (#823): ${liveCount} parallel session(s) are live and this ` +
    `session is reading repo source in the SHARED main tree without worktree isolation. ` +
    `Run \`pnpm task:worktree <N>\` → \`EnterWorktree path:.claude/worktrees/<N>\` before ` +
    `further repo-source Read/Grep/Glob (AGENTS.md §6 — analysis reads included, #418). ` +
    `Warn-level only: board/triage reads may continue.`
  );
}

/** The single softened notice (#854) shown to a read-only orchestration lead in
 * place of a warning-per-read: it makes the carve-out explicit and states that
 * the full guard resumes on the first main-tree WRITE. */
export function softenedNoticeMessage(liveCount) {
  return (
    `ℹ main-tree read guard (#823/#854): ${liveCount} parallel session(s) live; you are ` +
    `reading SHARED main-tree source. Read-only orchestration carve-out — this is the ONE ` +
    `notice; further main-tree reads stay silent. The FULL warning resumes on your first ` +
    `main-tree WRITE. If you will EDIT main-tree files, isolate now: ` +
    `\`pnpm task:worktree <N>\` → \`EnterWorktree path:.claude/worktrees/<N>\` (AGENTS.md §6, #418).`
  );
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

/**
 * Layer the #854 read-only carve-out over the pure `decideWarn()` verdict.
 * Given the warn decision and the per-session `{noticeShown, mainTreeWriteSeen}`
 * state, decide what the read guard emits:
 * - warn conditions don't hold → `{ action: "silent" }`.
 * - a main-tree write has been seen this session → `{ action: "warn" }` (FULL,
 *   as #823, unchanged).
 * - else, notice not yet shown → `{ action: "notice", setNoticeShown: true }`.
 * - else → `{ action: "silent" }`.
 */
export function decideReadAction({ warnDecision, state }) {
  if (!warnDecision || !warnDecision.warn) return { action: "silent" };
  const s = state || {};
  if (s.mainTreeWriteSeen) {
    return { action: "warn", liveCount: warnDecision.liveCount };
  }
  if (!s.noticeShown) {
    return {
      action: "notice",
      liveCount: warnDecision.liveCount,
      setNoticeShown: true,
    };
  }
  return { action: "silent" };
}

/**
 * Pure decision seam (unit-tested without a real FS): given the hook payload
 * fields, the parsed flag file, and an injectable `statMtimeMs(path)` probe,
 * decide whether to warn. Returns `{ warn: false }` or `{ warn: true, liveCount }`.
 */
export function decideWarn({
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
  if (!/^(Read|Grep|Glob)$/.test(toolName || "")) return { warn: false };
  if (!cwd || !projectDir) return { warn: false };
  // Worktree entered (session cwd, or the session was born in one) → isolated.
  if (inWorktree(cwd) || inWorktree(projectDir)) return { warn: false };
  if (!flag || !Array.isArray(flag.sessions)) return { warn: false };

  // Freshness re-check: the flag is a session-start snapshot; only sessions
  // whose log file is STILL being touched count. A stale flag never warns.
  const live = flag.sessions.filter((s) => {
    if (!s || !s.logPath || s.id === sessionId) return false;
    const m = statMtimeMs(s.logPath);
    return m != null && nowMs - m <= freshWindowMs;
  });
  if (live.length === 0) return { warn: false };

  // Only repo SOURCE paths: under the main root, but not the repo's own
  // `.claude/` (settings, worktrees, this flag) or `.git/` plumbing.
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
    const payload = JSON.parse(readFileSync(0, "utf8"));
    const projectDir = process.env.CLAUDE_PROJECT_DIR || payload.cwd || "";
    let flag = null;
    try {
      flag = JSON.parse(readFileSync(resolve(projectDir, FLAG_REL), "utf8"));
    } catch {
      // No flag → bootstrap saw no parallel sessions (or never ran) → allow.
    }
    const decision = decideWarn({
      toolName: payload.tool_name,
      toolInput: payload.tool_input,
      cwd: payload.cwd || "",
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
    // #854 carve-out: consult per-session state to decide full warning vs. the
    // one-time softened notice vs. silence. Fail-open — a state error yields the
    // default (both-false) state, i.e. the pre-#854 first-hit warning behavior.
    const statePath = stateFilePath(projectDir, payload.session_id || "");
    const state = readState(statePath);
    const action = decideReadAction({ warnDecision: decision, state });
    if (action.action === "warn" || action.action === "notice") {
      const msg =
        action.action === "warn"
          ? warnMessage(action.liveCount)
          : softenedNoticeMessage(action.liveCount);
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
      if (action.setNoticeShown) {
        writeState(statePath, { ...state, noticeShown: true });
      }
    }
    process.exit(0);
  } catch {
    process.exit(0); // fail-open: never wedge a legitimate read on a guard bug
  }
}

// Entry-point guard (same pattern as agent-bootstrap.ts): run `main()` only
// when invoked directly, so the guard-tests spec can import the pure seams
// without firing stdin reads / process.exit.
const invoked = process.argv[1] ? norm(resolve(process.argv[1])) : "";
if (invoked && invoked === norm(fileURLToPath(import.meta.url))) {
  main();
}

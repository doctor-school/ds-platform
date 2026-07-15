#!/usr/bin/env node
// PreToolUse guard (WARN-level, #913): make the AGENTS.md §6 orchestration-
// default divergence visible DETERMINISTICALLY, at the decision point, and
// model-agnostic (origin: #700 Opus-vs-Fable orchestration retro). §6 says
// ORCHESTRATION is the default execution mode — deliverable edits are DISPATCHED
// to subagents, not typed inline by the lead. This hook counts CONSECUTIVE
// lead-authored Edit/Write/MultiEdit tool calls in the SHARED main tree with NO
// intervening Agent dispatch; the streak RESETS on an Agent call. When the
// streak reaches the threshold (DISPATCH_WARN_THRESHOLD) it emits a non-blocking
// WARN naming §6 + the sanctioned inline carve-outs, so the lead must
// consciously continue inline or dispatch. Phase-0 severity: WARN, never BLOCK.
//
// Contract: reads the PreToolUse hook JSON on stdin ({session_id, cwd,
// tool_name, tool_input}). Warn = exit 0 + JSON on stdout ({systemMessage,
// hookSpecificOutput.permissionDecision:"allow"}). Silent allow = exit 0, no
// output. FAIL-OPEN: any parse/logic/FS error exits 0 — a guard bug must never
// wedge a legitimate tool call.
//
// Registered on matcher `Agent|Edit|Write|MultiEdit` so the hook observes both
// the mutations it counts and the Agent dispatches that reset the streak. Reads,
// Bash, Grep between edits do NOT fire this matcher — so they neither count nor
// reset (they are not "an intervening Agent dispatch"), which is exactly the
// "consecutive mutations with no intervening dispatch" semantics we want.
//
// PROVISIONAL carve-out list (the reworked §6 carve-out list is tracked
// separately at #914 / #700-M2; a provisional list is explicitly sanctioned by
// #913). The guard stays silent for:
//   1. Worktree-isolated sessions — cwd (or projectDir) under
//      `.claude/worktrees/<N>`. These are the DISPATCH TARGETS (subagent
//      executors) or an isolated lead; they are *supposed* to edit inline. Only
//      the shared main tree — where the orchestration lead operates — is warned.
//   2. Read-only / recon sessions — naturally never reach the threshold: with no
//      Edit/Write/MultiEdit calls the streak stays 0, so nothing is emitted.
//   3. An explicit sanctioned-inline opt-out: a session in a genuinely inline
//      mode (recon/scope-framing, an engineering-task inline discipline gate,
//      ADR/spec inline authoring) exports `DS_DISPATCH_GUARD_DISABLE=1`.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Threshold: the streak length at which the guard first WARNs. A single named,
 * documented constant — TUNABLE once the #700-M4 corpus data lands (the value
 * balances "nagging on every legit 2-edit inline touch" vs. "catching a lead
 * that has silently typed a whole deliverable"). Default 3.
 */
export const DISPATCH_WARN_THRESHOLD = 3;

/** Mutation tools whose consecutive run (no intervening Agent) is counted. */
export const MUTATION_TOOL_RE = /^(Edit|Write|MultiEdit)$/;

/** Dispatch tools that RESET the streak. `Agent` is this harness's subagent-
 * spawn tool (per #913); `Task` is accepted as its cross-harness alias. */
export const DISPATCH_TOOL_RE = /^(Agent|Task)$/;

/** Env var a sanctioned-inline session exports to opt out (provisional #914). */
export const CARVE_OUT_ENV = "DS_DISPATCH_GUARD_DISABLE";

/** Per-session guard-state directory. Holds one `<session_id>.json` per session
 * with `{streak}`. Gitignored (machine state, not repo content). */
export const GUARD_STATE_DIR_REL = ".claude/dispatch-guard-state";

/** Case-insensitive + separator-insensitive path normalization (Windows FS). */
export function norm(p) {
  return String(p)
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/** True when a path sits inside a linked worktree checkout. */
export function inWorktree(p) {
  return /\/\.claude\/worktrees(\/|$)/.test(norm(p));
}

/** True when the session opted out via the sanctioned-inline env flag. */
export function isCarveOut(env = process.env) {
  const v = env && env[CARVE_OUT_ENV];
  return v === "1" || v === "true" || v === "yes";
}

/** Resolve the per-session guard-state file path. `session_id` is sanitized to
 * a safe filename segment; a missing id degrades to a shared `unknown` file
 * (fail-open — never throws). */
export function stateFilePath(projectDir, sessionId) {
  const safe = String(sessionId || "unknown").replace(/[^A-Za-z0-9._-]/g, "_");
  return resolve(projectDir, GUARD_STATE_DIR_REL, `${safe}.json`);
}

/** Read the persisted streak for a session. Missing/corrupt/negative → 0
 * (fail-open). `readFile` is injectable for unit tests. */
export function readStreak(path, readFile = (p) => readFileSync(p, "utf8")) {
  try {
    const s = JSON.parse(readFile(path)) || {};
    return Number.isFinite(s.streak) && s.streak >= 0 ? s.streak : 0;
  } catch {
    return 0;
  }
}

/** Persist the streak (best-effort). Any FS error is swallowed — a state-write
 * failure must NEVER block or crash a tool call. FS ops are injectable for tests. */
export function writeStreak(path, streak, deps = {}) {
  const mkdir = deps.mkdir || ((d) => mkdirSync(d, { recursive: true }));
  const writeFile = deps.writeFile || ((p, c) => writeFileSync(p, c));
  try {
    mkdir(dirname(path));
    writeFile(path, JSON.stringify({ streak }));
  } catch {
    // fail-open: state persistence is best-effort.
  }
}

export function warnMessage(streak, threshold = DISPATCH_WARN_THRESHOLD) {
  return (
    `⚠ dispatch guard (#913): ${streak} consecutive lead-authored ` +
    `Edit/Write/MultiEdit calls in the SHARED main tree with NO intervening ` +
    `Agent dispatch (threshold ${threshold}). AGENTS.md §6 makes ORCHESTRATION ` +
    `the default execution mode — deliverable edits are DISPATCHED to subagents, ` +
    `not typed inline by the lead. Either dispatch the remaining edits (Agent), ` +
    `or, if this is a sanctioned inline mode — recon / scope-framing, an ` +
    `engineering-task inline discipline gate, ADR/spec inline authoring, or a ` +
    `worktree-isolated executor — continue consciously. WARN-level only ` +
    `(Phase 0): never blocks. Provisional carve-out list; full rework at #914.`
  );
}

/**
 * Pure decision seam (unit-tested without a real FS): given the tool name, the
 * session cwd/projectDir, the persisted `streak`, the threshold, and whether an
 * explicit carve-out is active, decide the action and the streak to persist.
 * - Agent/Task dispatch          → `{ action: "reset", streak: 0 }`.
 * - non-mutation tool            → `{ action: "silent" }` (no state change).
 * - mutation, but carved out     → `{ action: "silent" }` (worktree / env optout).
 * - mutation, streak+1 < N       → `{ action: "count", streak }`.
 * - mutation, streak+1 >= N      → `{ action: "warn",  streak }`.
 */
export function decideDispatch({
  toolName,
  cwd,
  projectDir,
  streak,
  threshold = DISPATCH_WARN_THRESHOLD,
  carveOut = false,
}) {
  if (DISPATCH_TOOL_RE.test(toolName || "")) {
    return { action: "reset", streak: 0 };
  }
  if (!MUTATION_TOOL_RE.test(toolName || "")) return { action: "silent" };
  // Carve-outs: an explicit sanctioned-inline opt-out, or a worktree-isolated
  // session (dispatch target / isolated lead). Only the shared main tree warns.
  if (carveOut) return { action: "silent" };
  if (inWorktree(cwd) || inWorktree(projectDir)) return { action: "silent" };
  const next = (Number.isFinite(streak) && streak >= 0 ? streak : 0) + 1;
  if (next >= threshold) return { action: "warn", streak: next };
  return { action: "count", streak: next };
}

function main() {
  try {
    const payload = JSON.parse(readFileSync(0, "utf8"));
    const projectDir = process.env.CLAUDE_PROJECT_DIR || payload.cwd || "";
    const statePath = stateFilePath(projectDir, payload.session_id || "");
    const streak = readStreak(statePath);
    const decision = decideDispatch({
      toolName: payload.tool_name,
      cwd: payload.cwd || "",
      projectDir,
      streak,
      carveOut: isCarveOut(process.env),
    });
    if (
      decision.action === "reset" ||
      decision.action === "count" ||
      decision.action === "warn"
    ) {
      writeStreak(statePath, decision.streak);
    }
    if (decision.action === "warn") {
      const msg = warnMessage(decision.streak, DISPATCH_WARN_THRESHOLD);
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
    }
    process.exit(0);
  } catch {
    process.exit(0); // fail-open: never wedge a legitimate tool call on a bug
  }
}

// Entry-point guard (same pattern as main-tree-read-guard.mjs): run `main()`
// only when invoked directly, so the guard-tests spec can import the pure seams
// without firing stdin reads / process.exit.
const invoked = process.argv[1] ? norm(resolve(process.argv[1])) : "";
if (invoked && invoked === norm(fileURLToPath(import.meta.url))) {
  main();
}

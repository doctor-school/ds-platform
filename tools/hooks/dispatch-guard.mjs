#!/usr/bin/env node
// PreToolUse advisory (#913): repeated shared-main edits prompt isolation and
// a proportionate choice of authoring/delegation (AGENTS.md §6). The hook
// remains WARN-only, once per session; it does not mandate delegation.
// Existing counting, threshold, reset and worktree exemptions are unchanged.
//

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  projectRoot,
  actorIdentity,
  canonicalPath,
  isNewDispatchTool,
} from "./hook-compat.mjs";
import { gitWorktreeRoots } from "./worktree-path-guard.mjs";

/**
 * Threshold: the streak length at which the guard first WARNs. A single named,
 * documented constant — TUNABLE once the #700-M4 corpus data lands (the value
 * balances "nagging on every legit 2-edit inline touch" vs. "catching a lead
 * that has silently typed a whole deliverable"). Default 3.
 */
export const DISPATCH_WARN_THRESHOLD = 3;

/** Mutation tools whose consecutive run (no intervening Agent) is counted. */
export const MUTATION_TOOL_RE = /^(Edit|Write|MultiEdit|apply_patch)$/;

/** Dispatch tools that RESET the streak. `Agent` is this harness's subagent-
 * spawn tool (per #913); `Task` is accepted as its cross-harness alias. */
export { DISPATCH_TOOL_RE } from "./hook-compat.mjs";

/** Env var a sanctioned-inline session exports to opt out (provisional #914). */
export const CARVE_OUT_ENV = "DS_DISPATCH_GUARD_DISABLE";

/** Per-session guard-state directory. Holds one `<session_id>.json` per session
 * with `{streak, warned}`. Gitignored (machine state, not repo content). */
export const GUARD_STATE_DIR_REL = ".claude/dispatch-guard-state";

/** Case-insensitive + separator-insensitive path normalization (Windows FS). */
export function norm(p) {
  return String(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
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

/** Read the once-per-session WARN latch. Missing/corrupt → `false` (fail-open:
 * a lost latch costs at most one extra WARN, never a wedged call). */
export function readWarned(path, readFile = (p) => readFileSync(p, "utf8")) {
  try {
    return JSON.parse(readFile(path))?.warned === true;
  } catch {
    return false;
  }
}

/** Persist the streak (best-effort). Any FS error is swallowed — a state-write
 * failure must NEVER block or crash a tool call. FS ops are injectable for tests.
 * `warned` is the once-per-session latch; omitted ⇒ the field is not written. */
export function writeStreak(path, streak, deps = {}, warned = undefined) {
  const mkdir = deps.mkdir || ((d) => mkdirSync(d, { recursive: true }));
  const writeFile = deps.writeFile || ((p, c) => writeFileSync(p, c));
  try {
    mkdir(dirname(path));
    const state =
      warned === undefined ? { streak } : { streak, warned: warned === true };
    writeFile(path, JSON.stringify(state));
  } catch {
    // fail-open: state persistence is best-effort.
  }
}

export function warnMessage(streak, threshold = DISPATCH_WARN_THRESHOLD) {
  return (
    `⚠ dispatch guard (#913): ${streak} consecutive lead-authored ` +
    `Edit/Write/MultiEdit calls in the SHARED main tree with NO intervening ` +
    `Agent dispatch (threshold ${threshold}). AGENTS.md §6 requires isolation ` +
    `for parallel authoring. Use an isolated worktree for inline bounded work; ` +
    `delegate when independent work or context savings justify the handoff. ` +
    `A mutation count alone does not require delegation. WARN-level only ` +
    `(Phase 0): never blocks, and this is the ONLY time it is said this session.`
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
 * - mutation, streak+1 >= N, not yet warned this session → `{ action: "warn", streak }`.
 * - mutation, streak+1 >= N, ALREADY warned this session → `{ action: "count", streak }`.
 *
 * The `warned` latch (#1700) caps the guard at ONE WARN per session: the signal
 * is "you are drifting inline", and repeating it on every subsequent mutation
 * was pure noise (a week-long transcript audit found the guard the second-
 * loudest hook, with zero blocks). Counting itself is unchanged — the streak
 * keeps advancing and still RESETS on an Agent dispatch.
 */
export function decideDispatch({
  toolName,
  cwd,
  projectDir,
  streak,
  threshold = DISPATCH_WARN_THRESHOLD,
  carveOut = false,
  warned = false,
}) {
  if (isNewDispatchTool(toolName)) {
    return { action: "reset", streak: 0 };
  }
  if (!MUTATION_TOOL_RE.test(toolName || "")) return { action: "silent" };
  // Carve-outs: an explicit sanctioned-inline opt-out, or a worktree-isolated
  // session (dispatch target / isolated lead). Only the shared main tree warns.
  if (carveOut) return { action: "silent" };
  if (inWorktree(cwd) || inWorktree(projectDir)) return { action: "silent" };
  const next = (Number.isFinite(streak) && streak >= 0 ? streak : 0) + 1;
  if (next >= threshold && !warned) return { action: "warn", streak: next };
  return { action: "count", streak: next };
}

function main() {
  try {
    const payload = JSON.parse(readFileSync(0, "utf8"));
    const projectDir = projectRoot(payload);
    const statePath = stateFilePath(projectDir, actorIdentity(payload));
    const streak = readStreak(statePath);
    const warned = readWarned(statePath);
    const decision = decideDispatch({
      toolName: payload.tool_name,
      cwd: payload.cwd || "",
      projectDir,
      streak,
      carveOut:
        isCarveOut(process.env) ||
        (() => {
          const roots = gitWorktreeRoots(projectDir);
          return (
            roots.length > 0 &&
            norm(canonicalPath(roots[0])) !== norm(canonicalPath(projectDir))
          );
        })(),
      warned,
    });
    if (
      decision.action === "reset" ||
      decision.action === "count" ||
      decision.action === "warn"
    ) {
      // The latch is sticky for the whole session — it is NOT cleared by the
      // Agent dispatch that resets the streak.
      writeStreak(
        statePath,
        decision.streak,
        {},
        warned || decision.action === "warn",
      );
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

// Entry-point guard (same pattern as worktree-path-guard.mjs): run `main()`
// only when invoked directly, so the guard-tests spec can import the pure seams
// without firing stdin reads / process.exit.
const invoked = process.argv[1] ? norm(resolve(process.argv[1])) : "";
if (invoked && invoked === norm(fileURLToPath(import.meta.url))) {
  main();
}

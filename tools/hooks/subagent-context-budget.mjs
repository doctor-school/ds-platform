#!/usr/bin/env node
/**
 * PreToolUse hook: SUBAGENT context budget — rotate at soft, fence at hard
 * (owner decision, 2026-08-18, #1374).
 *
 * Why: the 2026-08-10..18 token retro showed child agents cost ≈2× the lead;
 * 16 subagents crossed 200K context and the worst peaked at 586K over 323
 * turns, where ≈78% of its cost was cache-read (per-turn cost is linear in
 * context). Nothing limited subagents: no hook, no `maxTurns`, no rotation
 * rule. This hook makes the limit deterministic at the tool-call boundary.
 *
 * Contract (differs from the LEAD advisory `context-budget.mjs`, which is
 * operator-visible only and must NEVER talk to the model — this one DOES talk
 * to the model, because its addressee is a subagent, not the human):
 *   - Acts ONLY inside a subagent: stdin must carry `agent_id`. No `agent_id`
 *     ⇒ the call is the lead's ⇒ exit 0 with no output.
 *   - Context size = the SUBAGENT's own transcript (`transcript_path` points at
 *     `<project>/<session>/subagents/agent-<id>.jsonl`), last assistant usage
 *     block: input + cache_read + cache_creation — computed by the shared
 *     `contextTokensFromJsonl` imported from `context-budget.mjs` (single
 *     definition; never duplicate the parse).
 *   - ≥ SOFT_THRESHOLD → `additionalContext` ROTATE directive, emitted at the
 *     FIRST crossing and then again every +SOFT_REPEAT_STEP (per-agent state
 *     file, so a chatty agent is not nagged on every tool call).
 *   - ≥ HARD_THRESHOLD → `permissionDecision: "deny"` for every tool except the
 *     checkpoint-and-hand-back allow-list (`isAllowedUnderHardCap`), on EVERY
 *     call (no cadence — the fence must not have gaps).
 *
 * Thresholds are owner-tunable constants (see below). FAIL-OPEN: any parse /
 * IO / logic error exits 0 with no output — a budget probe must never wedge a
 * legitimate tool call.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { contextTokensFromJsonl } from "./context-budget.mjs";
import { projectRoot } from "./hook-compat.mjs";

/** Soft cap: the subagent is told to checkpoint and hand back (ROTATE).
 * Owner-tunable (owner decision 2026-08-18: 150K). */
export const SOFT_THRESHOLD = 150_000;

/** Hard cap: every tool call is DENIED except the checkpoint/hand-back
 * allow-list. Owner-tunable (owner decision 2026-08-18: 200K). */
export const HARD_THRESHOLD = 200_000;

/** After the first soft directive, re-emit once per this much extra context. */
export const SOFT_REPEAT_STEP = 25_000;

/** Per-agent cadence state, shared dir with the dispatch guard (gitignored). */
export const GUARD_STATE_DIR_REL = ".claude/dispatch-guard-state";

/** Filename-safe form of an id (agent ids are opaque strings). */
export function safeId(id) {
  return String(id || "unknown").replace(/[^A-Za-z0-9._-]/g, "_");
}

/** Per-agent cadence state file: `{ lastNotifiedAt }`. */
export function stateFilePath(projectDir, agentId) {
  return resolve(
    projectDir,
    GUARD_STATE_DIR_REL,
    `ctx-${safeId(agentId)}.json`,
  );
}

/** Read `{ lastNotifiedAt }`; missing/corrupt → `{ lastNotifiedAt: 0 }`. */
export function readState(path, readFile = (p) => readFileSync(p, "utf8")) {
  try {
    const s = JSON.parse(readFile(path)) || {};
    const v = s.lastNotifiedAt;
    return { lastNotifiedAt: Number.isFinite(v) && v >= 0 ? v : 0 };
  } catch {
    return { lastNotifiedAt: 0 };
  }
}

/** Persist cadence state (best-effort; a write failure never blocks a call). */
export function writeState(path, state, deps = {}) {
  const mkdir = deps.mkdir || ((d) => mkdirSync(d, { recursive: true }));
  const writeFile = deps.writeFile || ((p, c) => writeFileSync(p, c));
  try {
    mkdir(dirname(path));
    writeFile(path, JSON.stringify(state));
  } catch {
    // fail-open: cadence state is best-effort.
  }
}

/** Where the rotation checkpoint is written. The session scratchpad when the
 * harness exports one, else a stable tmp dir — never inside the repo. */
export function scratchpadDir(env = process.env) {
  return env.CLAUDE_SCRATCHPAD_DIR || resolve(tmpdir(), "claude-checkpoints");
}

/** Resolved checkpoint path for one agent — injected verbatim into the
 * directive so the subagent never has to invent a location. */
export function checkpointPath(agentId, env = process.env) {
  return resolve(scratchpadDir(env), `checkpoint-${safeId(agentId)}.md`);
}

/**
 * The ONLY tools a subagent may still run above the hard cap: git (WIP-commit,
 * push, inspect) and writing its own checkpoint file. Everything else is
 * denied — at 200K every further turn re-reads the whole context.
 */
export function isAllowedUnderHardCap(toolName, toolInput) {
  if (toolName === "Bash") {
    const command = String(toolInput?.command ?? "").trim();
    return (
      command.startsWith("git ") || command.startsWith("pnpm pr:preflight")
    );
  }
  if (toolName === "Write") {
    const filePath = String(toolInput?.file_path ?? "");
    const base = filePath.replace(/\\/g, "/").split("/").pop() ?? "";
    return /^checkpoint-.*\.md$/.test(base);
  }
  return false;
}

const CHECKPOINT_FIELDS =
  "done / remaining / files touched / branch + HEAD SHA / next command / open questions";

export function softMessage(contextTokens, path) {
  const k = Math.round(contextTokens / 1000);
  const soft = Math.round(SOFT_THRESHOLD / 1000);
  return (
    `Context ≈ ${k}K (soft cap ${soft}K). Finish the current atomic step only, ` +
    `WIP-commit on the branch, write \`${path}\` with: ${CHECKPOINT_FIELDS}, ` +
    `then return ≤20 lines whose FIRST line is \`ROTATE: ${path}\`. The lead ` +
    `re-dispatches a fresh agent from the checkpoint. Do not start new exploration.`
  );
}

export function hardMessage(contextTokens, path) {
  const k = Math.round(contextTokens / 1000);
  const hard = Math.round(HARD_THRESHOLD / 1000);
  return (
    `Context ≈ ${k}K — hard cap ${hard}K reached (#1374). Every tool is denied ` +
    `except \`git …\` / \`pnpm pr:preflight\` via Bash and writing ` +
    `\`checkpoint-*.md\`. WIP-commit on the branch, write \`${path}\` with: ` +
    `${CHECKPOINT_FIELDS}. Return now: first line \`ROTATE: ${path}\`, ≤20 lines.`
  );
}

/**
 * Pure decision seam (unit-tested without FS or stdin).
 * - below SOFT                         → `{ action: "silent" }`
 * - ≥ HARD, tool not allow-listed      → `{ action: "deny" }`
 * - ≥ HARD, tool allow-listed          → `{ action: "silent" }` (let it hand back)
 * - ≥ SOFT, first crossing / +STEP     → `{ action: "soft", state }`
 * - ≥ SOFT, already notified this step  → `{ action: "silent" }`
 * The returned `state` (when present) is what the caller must persist.
 */
export function decide({ contextTokens, toolName, toolInput, state }) {
  const ctx = Number.isFinite(contextTokens) ? contextTokens : 0;
  if (ctx >= HARD_THRESHOLD) {
    if (isAllowedUnderHardCap(toolName, toolInput)) return { action: "silent" };
    return { action: "deny" };
  }
  if (ctx < SOFT_THRESHOLD) return { action: "silent" };
  const last = Number.isFinite(state?.lastNotifiedAt)
    ? state.lastNotifiedAt
    : 0;
  if (last > 0 && ctx < last + SOFT_REPEAT_STEP) return { action: "silent" };
  return { action: "soft", state: { lastNotifiedAt: ctx } };
}

function main() {
  try {
    const payload = JSON.parse(readFileSync(0, "utf8"));
    const agentId = payload.agent_id;
    // Not a subagent → not our addressee. The lead has its own advisory hook.
    if (!agentId) process.exit(0);
    const transcriptPath = payload.transcript_path;
    if (!transcriptPath) process.exit(0);
    const contextTokens = contextTokensFromJsonl(
      readFileSync(transcriptPath, "utf8"),
    );
    const projectDir = projectRoot(payload);
    const statePath = stateFilePath(projectDir, agentId);
    const decision = decide({
      contextTokens,
      toolName: payload.tool_name,
      toolInput: payload.tool_input,
      state: readState(statePath),
    });
    if (decision.action === "silent") process.exit(0);
    const path = checkpointPath(agentId);
    if (decision.action === "deny") {
      const msg = hardMessage(contextTokens, path);
      process.stdout.write(
        JSON.stringify({
          systemMessage: msg,
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: msg,
          },
        }),
      );
      process.exit(0);
    }
    writeState(statePath, decision.state);
    const msg = softMessage(contextTokens, path);
    process.stdout.write(
      JSON.stringify({
        systemMessage: msg,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: msg,
          additionalContext: msg,
        },
      }),
    );
    process.exit(0);
  } catch {
    process.exit(0); // fail-open: never wedge a legitimate tool call on a bug
  }
}

// Entry-point guard: run `main()` only when invoked directly, so the spec can
// import the pure seams without firing stdin reads / process.exit.
const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
if (invoked && invoked === resolve(fileURLToPath(import.meta.url))) {
  main();
}

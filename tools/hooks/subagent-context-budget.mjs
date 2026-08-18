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
 *   - VERIFIED PreToolUse stdin shape inside a subagent (probed live in this
 *     CLI version, 2026-08-18, from a real `ds-explorer` dispatch):
 *       {"session_id":"<LEAD session id>",
 *        "transcript_path":"<projects>/<slug>/<LEAD session id>.jsonl",
 *        "cwd":"…","agent_id":"a803ac1b8bab61dc0","agent_type":"ds-explorer",
 *        "hook_event_name":"PreToolUse","tool_name":"Read",
 *        "tool_input":{…},"tool_use_id":"…"}
 *     i.e. `transcript_path` is the LEAD's transcript, and there is NO
 *     `agent_transcript_path` field on PreToolUse here. Measuring
 *     `transcript_path` would apply subagent thresholds to the LEAD's context
 *     and deny every dispatched agent from its first tool call.
 *   - Context size = the SUBAGENT's OWN transcript only, resolved by
 *     `resolveSubagentTranscript()`: `agent_transcript_path` when a future CLI
 *     supplies it, else the derived sibling
 *     `<dirname(transcript_path)>/<session_id>/subagents/agent-<agent_id>.jsonl`
 *     (verified to exist on disk). A path not under a `subagents/` segment, or
 *     a path that does not exist, ⇒ SILENT — never fall back to the lead
 *     transcript. The last assistant usage block (input + cache_read +
 *     cache_creation) is computed by the shared `contextTokensFromJsonl`
 *     imported from `context-budget.mjs` (single definition; never duplicate
 *     the parse), over the TAIL of the file (the runs this hook targets write
 *     tens of MB and the parse scans from the end anyway).
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
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

/** Where the rotation checkpoint is written: `<tmp>/claude-checkpoints`, never
 * inside the repo. The CLI exports no per-session scratchpad variable to hooks
 * (only `CLAUDE_PROJECT_DIR`), so this is a fixed, documented location rather
 * than a guess at an env name; the absolute path is injected verbatim into the
 * directive, so the lead always knows where the checkpoint landed. */
export function checkpointDir() {
  return resolve(tmpdir(), "claude-checkpoints");
}

/** Resolved checkpoint path for one agent — injected verbatim into the
 * directive so the subagent never has to invent a location. */
export function checkpointPath(agentId) {
  return resolve(checkpointDir(), `checkpoint-${safeId(agentId)}.md`);
}

/**
 * The subagent's OWN transcript, or `null` when it cannot be established.
 * See the header for the verified PreToolUse stdin shape. `null` ⇒ the caller
 * MUST stay silent: measuring the lead's transcript with subagent thresholds
 * would fence every dispatched agent from its first tool call.
 */
export function resolveSubagentTranscript(payload, exists = existsSync) {
  const explicit = payload?.agent_transcript_path;
  let candidate =
    typeof explicit === "string" && explicit.trim() ? explicit : "";
  if (!candidate) {
    const transcriptPath = payload?.transcript_path;
    const sessionId = payload?.session_id;
    const agentId = payload?.agent_id;
    if (
      typeof transcriptPath !== "string" ||
      !transcriptPath ||
      !sessionId ||
      !agentId
    ) {
      return null;
    }
    candidate = join(
      dirname(transcriptPath),
      safeId(sessionId),
      "subagents",
      `agent-${safeId(agentId)}.jsonl`,
    );
  }
  // Guard-rail for BOTH branches: a path not under a `subagents/` segment is
  // somebody else's transcript (the lead's, typically) — refuse to measure it.
  if (!/(^|[\\/])subagents[\\/]/.test(candidate)) return null;
  return exists(candidate) ? candidate : null;
}

/** Bytes of the transcript tail that are parsed. `contextTokensFromJsonl`
 * scans from the end and stops at the last assistant usage block, so the tail
 * yields the same number as the whole file while keeping the per-tool-call cost
 * bounded on the multi-MB logs this hook exists to catch. */
export const TAIL_BYTES = 512 * 1024;

/** Last `TAIL_BYTES` of a file as UTF-8 (a truncated first line is fine — the
 * parser skips unparseable lines). Any IO error propagates to the fail-open
 * catch in `main()`. */
export function readTail(path, maxBytes = TAIL_BYTES) {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, maxBytes);
    const buf = Buffer.allocUnsafe(length);
    readSync(fd, buf, 0, length, size - length);
    return buf.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/**
 * The ONLY tools a subagent may still run above the hard cap: git (WIP-commit,
 * push, inspect) and writing its own checkpoint file. Everything else is
 * denied — at 200K every further turn re-reads the whole context.
 */
export function isAllowedUnderHardCap(toolName, toolInput) {
  if (toolName === "Bash") {
    const command = String(toolInput?.command ?? "").trim();
    // Chained / substituted commands are rejected: the prefix must describe the
    // WHOLE command, else `git status && pnpm build` routes around the fence.
    if (/[;&|`]|\$\(|\n/.test(command)) return false;
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
    const transcriptPath = resolveSubagentTranscript(payload);
    // No transcript of OUR OWN ⇒ nothing this hook is allowed to measure.
    if (!transcriptPath) process.exit(0);
    const contextTokens = contextTokensFromJsonl(readTail(transcriptPath));
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
    // `additionalContext` alone carries the directive. No `permissionDecision`
    // here: this hook matches `.*`, and "allow" would auto-approve whichever
    // arbitrary call happened to cross the soft cap.
    process.stdout.write(
      JSON.stringify({
        systemMessage: msg,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
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

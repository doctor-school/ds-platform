#!/usr/bin/env node
/**
 * PreToolUse hook (`Agent|Task`): LEAD context budget — warn at soft, deny NEW
 * dispatches at hard (owner decision, 2026-08-31, #1693).
 *
 * Why: the 2026-08-31 retro over 12 session logs showed orchestration LEADS
 * blowing past the one-wave budget with zero in-band signal — session
 * `edea8a4c` peaked at 325K (a fresh 3-dispatch wave STARTED at 208K and new
 * dispatches kept coming at 300–316K, after two explicit owner handoff
 * requests); `c08cc5d8` peaked at 236K (fresh reviewer dispatched at 223K).
 * Healthy one-wave sessions in the same window land at 141–150K. Nothing
 * enforced AGENTS.md §6 «one wave per lead session»:
 *   1. `context-budget.mjs` is operator-advisory only (`systemMessage` never
 *      reaches the model — owner decision 2026-07-16, PR #1027), and
 *   2. it fires on UserPromptSubmit only, while orchestration sessions run on
 *      `<task-notification>` turns that never submit a prompt.
 *
 * Contract (the addressee here IS the model — unlike `context-budget.mjs`,
 * which must never talk to it):
 *   - Matcher is `Agent|Task` ONLY: the hook fires at the moment a NEW dispatch
 *     is requested. It therefore never interrupts in-flight work — the failure
 *     mode that killed the pre-#1027 directive design. Nothing is denied except
 *     starting another agent.
 *   - Acts ONLY for the LEAD. PreToolUse stdin inside a SUBAGENT carries
 *     `agent_id` (verified 2026-08-18, see `subagent-context-budget.mjs`);
 *     a LEAD call has NO `agent_id`, and its `transcript_path` IS the lead's
 *     own transcript. So: `agent_id` present ⇒ exit 0 silent (subagents are
 *     governed coercively by `subagent-context-budget.mjs`, #1374), absent ⇒
 *     measure `transcript_path` directly.
 *   - Context size = last assistant usage block (input + cache_read +
 *     cache_creation), computed by the shared `contextTokensFromJsonl` imported
 *     from `context-budget.mjs` — single definition, never duplicated — over
 *     the file TAIL (`readTail`, shared with the subagent hook: lead transcripts
 *     of the runs this exists to catch are tens of MB and the parser scans from
 *     the end anyway).
 *   - ≥ SOFT_THRESHOLD → allow, inject an `additionalContext` warning: finish
 *     the current wave, start no new one. No cadence/throttle state: dispatches
 *     are rare events, unlike the subagent hook's per-tool-call firing.
 *   - ≥ HARD_THRESHOLD → `permissionDecision: "deny"`: accept the results of
 *     the agents already running, finish PR tails by hand, /wrap + handoff.
 *   - Override hatch: the marker file `.claude/lead-budget-override` in the
 *     repo root lifts the tiers, LOUDLY (an `additionalContext` line saying the
 *     override is active, so it can never be silently permanent). It is created
 *     ONLY on an explicit owner instruction and removed by /wrap.
 *
 * Thresholds are owner-tunable constants (see below). FAIL-OPEN: any parse / IO
 * / logic error exits 0 with no output — a budget probe must never wedge a
 * legitimate dispatch.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { contextTokensFromJsonl } from "./context-budget.mjs";
import { projectRoot } from "./hook-compat.mjs";
import { readTail } from "./subagent-context-budget.mjs";

/** Soft cap: the wave in flight may finish; no NEW wave may start.
 * Owner-tunable (owner decision 2026-08-31: 120K). */
export const SOFT_THRESHOLD = 120_000;

/** Hard cap: a new dispatch is DENIED — hand off instead.
 * Owner-tunable (owner decision 2026-08-31: 160K). */
export const HARD_THRESHOLD = 160_000;

/** Owner-only escape hatch, repo-relative. Gitignored: it is a live-session
 * marker, never a committed setting. */
export const OVERRIDE_REL = ".claude/lead-budget-override";

/** Absolute path of the override marker for a given repo root. */
export function overridePath(projectDir) {
  return resolve(projectDir, OVERRIDE_REL);
}

/** Whether the owner override marker is present (missing ⇒ tiers apply). */
export function overrideActive(projectDir, exists = existsSync) {
  try {
    return exists(overridePath(projectDir));
  } catch {
    return false;
  }
}

export function softMessage(contextTokens) {
  const k = Math.round(contextTokens / 1000);
  const soft = Math.round(SOFT_THRESHOLD / 1000);
  return (
    `⚠ Контекст лида ≈${k}K ≥ ${soft}K — текущую волну довести, новую НЕ ` +
    `начинать; волна легла → /wrap + handoff.`
  );
}

export function hardMessage(contextTokens) {
  const k = Math.round(contextTokens / 1000);
  const hard = Math.round(HARD_THRESHOLD / 1000);
  return (
    `⛔ Контекст лида ≈${k}K ≥ ${hard}K — новый диспатч заблокирован. Прими ` +
    `результаты уже запущенных агентов, доведи хвосты PR руками → /wrap + ` +
    `handoff; продолжение — в новой сессии. Override — только по явному ` +
    `указанию владельца: файл ${OVERRIDE_REL}.`
  );
}

export function overrideMessage(contextTokens) {
  const k = Math.round(contextTokens / 1000);
  const soft = Math.round(SOFT_THRESHOLD / 1000);
  return (
    `⚠ Контекст лида ≈${k}K ≥ ${soft}K, но действует OVERRIDE (${OVERRIDE_REL}) ` +
    `— бюджет диспатчей снят по указанию владельца. Держи волну минимальной; ` +
    `файл снимается на /wrap.`
  );
}

/**
 * Pure decision seam (unit-tested without FS or stdin).
 * - below SOFT                    → `{ action: "silent" }`
 * - ≥ SOFT, override marker set   → `{ action: "override" }` (loud allow)
 * - ≥ HARD                        → `{ action: "deny" }`
 * - ≥ SOFT                        → `{ action: "soft" }`
 */
export function decide({ contextTokens, override }) {
  const ctx = Number.isFinite(contextTokens) ? contextTokens : 0;
  if (ctx < SOFT_THRESHOLD) return { action: "silent" };
  if (override) return { action: "override" };
  if (ctx >= HARD_THRESHOLD) return { action: "deny" };
  return { action: "soft" };
}

function main() {
  try {
    const payload = JSON.parse(readFileSync(0, "utf8"));
    // A subagent's dispatch is not ours: `subagent-context-budget.mjs` owns it.
    if (payload.agent_id) process.exit(0);
    const transcriptPath = payload.transcript_path;
    if (typeof transcriptPath !== "string" || !transcriptPath) process.exit(0);
    const contextTokens = contextTokensFromJsonl(readTail(transcriptPath));
    const decision = decide({
      contextTokens,
      override: overrideActive(projectRoot(payload)),
    });
    if (decision.action === "silent") process.exit(0);
    if (decision.action === "deny") {
      const msg = hardMessage(contextTokens);
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
    const msg =
      decision.action === "override"
        ? overrideMessage(contextTokens)
        : softMessage(contextTokens);
    // `additionalContext` only — no `permissionDecision: "allow"`, which would
    // auto-approve the dispatch and bypass the operator's own permission view.
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
    process.exit(0); // fail-open: never wedge a legitimate dispatch on a bug
  }
}

// Entry-point guard: run `main()` only when invoked directly, so the spec can
// import the pure seams without firing stdin reads / process.exit.
const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
if (invoked && invoked === resolve(fileURLToPath(import.meta.url))) {
  main();
}

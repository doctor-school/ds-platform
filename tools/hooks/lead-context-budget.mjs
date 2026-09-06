#!/usr/bin/env node
/** PreToolUse dispatch boundary (Agent/Task/spawn_agent). Claude retains
 * 120K/160K; Codex uses 70%/85% of the reported effective model window.
 * Only new dispatch is denied, never completion of already-running agents.
 * Missing telemetry emits an advisory. Owner override remains loud and scoped.
 * Transcript parsing is a best-effort adapter, not a stable host API. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  contextReadingFromJsonl,
  codexBudgetDecision,
  codexBudgetMessage,
} from "./context-budget.mjs";
import { projectRoot, telemetryUnavailable } from "./hook-compat.mjs";
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
    `начинать; волна легла → handoff (skill handoff-prompt); /wrap — только по команде владельца.`
  );
}

export function hardMessage(contextTokens) {
  const k = Math.round(contextTokens / 1000);
  const hard = Math.round(HARD_THRESHOLD / 1000);
  return (
    `⛔ Контекст лида ≈${k}K ≥ ${hard}K — новый диспатч заблокирован. Прими ` +
    `результаты уже запущенных агентов, доведи хвосты PR руками → handoff ` +
    `(skill handoff-prompt; /wrap — только владелец); продолжение — в новой ` +
    `сессии. Override — только по явному ` +
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
    if (typeof transcriptPath !== "string" || !transcriptPath)
      throw new Error("missing transcript");
    const reading = contextReadingFromJsonl(readTail(transcriptPath));
    const contextTokens = reading.tokens;
    if (
      process.env.DS_HOOK_HARNESS === "codex" ||
      reading.harness === "codex"
    ) {
      const action = codexBudgetDecision(reading);
      if (action === "unavailable") throw new Error("missing telemetry");
      if (action === "silent") process.exit(0);
      const msg = codexBudgetMessage(reading, action);
      const output = { hookEventName: "PreToolUse", additionalContext: msg };
      if (action === "deny" && !overrideActive(projectRoot(payload)))
        Object.assign(output, {
          permissionDecision: "deny",
          permissionDecisionReason: msg,
        });
      else if (overrideActive(projectRoot(payload)))
        output.additionalContext += " Owner budget override active.";
      process.stdout.write(
        JSON.stringify({
          systemMessage: output.additionalContext,
          hookSpecificOutput: output,
        }),
      );
      process.exit(0);
    }
    if (contextTokens === null) throw new Error("missing telemetry");
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
    process.stdout.write(JSON.stringify(telemetryUnavailable("Lead")));
    process.exit(0); // fail-open: never wedge a legitimate dispatch on a bug
  }
}

// Entry-point guard: run `main()` only when invoked directly, so the spec can
// import the pure seams without firing stdin reads / process.exit.
const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
if (invoked && invoked === resolve(fileURLToPath(import.meta.url))) {
  main();
}

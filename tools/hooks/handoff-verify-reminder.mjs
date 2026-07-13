#!/usr/bin/env node
// UserPromptSubmit hook (#839, retro 9d41016b F2): when the submitted prompt
// matches the handoff shape (the continuation sentinel sentence, or the
// `## Current task` + `## Where we stopped` header pair), remind that the
// FIRST action is piping the VERBATIM handoff to `pnpm handoff:verify` —
// never a hand-retyped paraphrase (re-typing injects false STALE rows).
// Canon for the procedure stays in `.claude/rules/repo-conventions.md` →
// Issue conventions (#743/#806) — this hook is only the enforcement seam.
//
// Contract (Claude Code UserPromptSubmit hook): stdin JSON carries
// {session_id, hook_event_name:"UserPromptSubmit", prompt, …}. Warn-only:
// exit 0 always; on a handoff-shaped prompt emit stdout JSON with a
// systemMessage (visible reminder) + hookSpecificOutput.additionalContext
// (model directive). FAIL-OPEN: any internal error exits 0 with no output —
// a guard bug must never break prompting (same pattern as context-budget.mjs).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The sentence Claude Code puts at the top of a continuation handoff. */
export const HANDOFF_SENTINEL_RE =
  /You are continuing a previous Claude Code session/i;

/** Headers the /handoff-prompt shape carries. A single header alone is an
 * ordinary prompt (e.g. someone quoting a README section); the PAIR is the
 * handoff signature. */
export const CURRENT_TASK_RE = /^##\s+Current task\b/im;
export const WHERE_WE_STOPPED_RE = /^##\s+Where we stopped\b/im;

/** Handoff shape: the sentinel sentence, or both signature headers. */
export function isHandoffPrompt(prompt) {
  const p = String(prompt || "");
  if (!p) return false;
  if (HANDOFF_SENTINEL_RE.test(p)) return true;
  return CURRENT_TASK_RE.test(p) && WHERE_WE_STOPPED_RE.test(p);
}

export function reminderOutput() {
  return {
    systemMessage:
      "⚠ Похоже на handoff из прошлой сессии — первый шаг: " +
      "прогнать его ВЕРБАТИМ через `pnpm handoff:verify` (stdin ok), " +
      "не пересказ.",
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext:
        "<handoff-verify-reminder>This prompt matches the session-handoff " +
        "shape. Before ANY other action, pipe the VERBATIM handoff text " +
        "(the exact pasted prompt — never a hand-retyped paraphrase, which " +
        "injects false STALE rows) into `pnpm handoff:verify` and reconcile " +
        "every flagged ref before acting on the handoff's premises. Canon: " +
        ".claude/rules/repo-conventions.md → Issue conventions " +
        "(#743/#806).</handoff-verify-reminder>",
    },
  };
}

function main() {
  try {
    const payload = JSON.parse(readFileSync(0, "utf8"));
    if (isHandoffPrompt(payload.prompt)) {
      process.stdout.write(JSON.stringify(reminderOutput()));
    }
    process.exit(0);
  } catch {
    process.exit(0); // fail-open: never break prompting on a guard bug
  }
}

// Entry-point guard (same pattern as completion-report-gate.mjs): run `main()`
// only when invoked directly, so the guard-tests spec can import the pure
// seams without firing stdin reads / process.exit.
function norm(p) {
  return String(p).replace(/\\/g, "/").toLowerCase();
}
const invoked = process.argv[1] ? norm(resolve(process.argv[1])) : "";
if (invoked && invoked === norm(fileURLToPath(import.meta.url))) {
  main();
}

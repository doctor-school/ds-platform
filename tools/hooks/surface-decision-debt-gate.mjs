#!/usr/bin/env node
// Stop-hook gate (#970): when the session is about to stop on a final assistant
// message that reads as a TASK-COMPLETION REPORT (same recognizer as the #824
// completion-report gate) but carries NO `surface-decision-debt:` line, block
// the stop with a corrective message naming the `surface-decision-debt` gate
// and AGENTS.md §3.8. The `surface-decision-debt` gate (AGENTS.md §3.8 + §6 —
// "any silent deviation from a documented convention MUST surface via
// surface-decision-debt before the iteration summary") is prose-only today;
// this makes it fire at the decision point, mechanically, the same way the
// completion-report gate enforces the «📈» section.
//
// COMPOSITION: this gate REUSES the completion-report gate's exact "terminal
// report" recognizer (`isCompletionReport` && not a decision-request / interim
// status / proposal-or-in-flight turn). The two gates therefore fire on the
// SAME set of terminal reports and compose independently — one blocks on a
// missing «📈», the other on a missing `surface-decision-debt:` line; the Stop
// hook harness runs both, and neither masks the other (each exits on its own
// missing marker). A genuine terminal report satisfying BOTH markers passes
// both gates.
//
// Contract (Claude Code Stop hook): stdin JSON carries {session_id,
// transcript_path, hook_event_name:"Stop", stop_hook_active}. Exit 0 = allow
// the stop; exit 2 with the message on stderr = block the stop and surface the
// message to the model. Loop guard: never exit 2 when `stop_hook_active` is
// true (the session already continued because a Stop hook blocked once).
// FAIL-OPEN: any error (missing/unreadable transcript, malformed JSON, no
// assistant message) exits 0 — a guard bug must never break a normal stop.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Reuse the completion-report gate's pure recognizer seams — the "terminal
// report" signal is defined in ONE place so the two Stop gates stay in lockstep
// and fire on exactly the same turns (#970).
import {
  extractLastAssistantText,
  isCompletionReport,
  isDecisionRequest,
  isInterimStatus,
  isProposalOrInFlight,
} from "./completion-report-gate.mjs";

/** Marker whose absence trips the gate — the `surface-decision-debt:` line the
 * §3.8 discipline gate requires before the result summary. Case-insensitive,
 * tolerant of whitespace before the colon; markdown emphasis around the label
 * (`**surface-decision-debt:**`) still contains the literal token, so the plain
 * regex matches it inherently. */
export const DEBT_MARKER_RE = /surface-decision-debt\s*:/i;

/** True when the turn carries a `surface-decision-debt:` line. The marker's
 * PRESENCE is sufficient — an empty `[]` or a list both satisfy it; the CONTENT
 * (whether every real deviation was surfaced) is the author's responsibility,
 * not something this gate can adjudicate (Issue #970 AC). */
export function hasDecisionDebtLine(text) {
  return DEBT_MARKER_RE.test(String(text || ""));
}

export function blockMessage() {
  return (
    "⛔ surface-decision-debt gate (#970): the final message reads as a " +
    "task-completion report but is missing the mandatory " +
    "`surface-decision-debt:` line required by AGENTS.md §3.8 (engineering-" +
    "task discipline) / §6 (Decision-debt Hard rule). Before the result " +
    "summary, run the `surface-decision-debt` gate and emit a " +
    "`surface-decision-debt:` line — either `surface-decision-debt: []` when " +
    "there was no silent deviation from a documented convention, or a list of " +
    "the deviations you made (each with its rationale)."
  );
}

/**
 * Pure decision seam (unit-tested without a real FS): block only when this is
 * not already a post-block continuation, the last assistant message reads as a
 * terminal completion report — the SAME recognizer the completion-report gate
 * uses (a completion report that is not a decision-request/approval-ask (#839),
 * not an in-flight checkpoint / interim status (#855), and not a proposal /
 * work-still-in-flight turn (#962)) — and the `surface-decision-debt:` line is
 * absent from it.
 */
export function decideBlock({ stopHookActive, lastAssistantText }) {
  if (stopHookActive) return { block: false };
  if (!lastAssistantText) return { block: false };
  if (isDecisionRequest(lastAssistantText)) return { block: false };
  if (isInterimStatus(lastAssistantText)) return { block: false };
  if (isProposalOrInFlight(lastAssistantText)) return { block: false };
  if (!isCompletionReport(lastAssistantText)) return { block: false };
  if (hasDecisionDebtLine(lastAssistantText)) return { block: false };
  return { block: true };
}

function main() {
  try {
    const payload = JSON.parse(readFileSync(0, "utf8"));
    if (payload.stop_hook_active) process.exit(0);
    if (!payload.transcript_path) process.exit(0);
    const lastAssistantText = extractLastAssistantText(
      readFileSync(payload.transcript_path, "utf8"),
    );
    const decision = decideBlock({
      stopHookActive: Boolean(payload.stop_hook_active),
      lastAssistantText,
    });
    if (decision.block) {
      process.stderr.write(blockMessage());
      process.exit(2);
    }
    process.exit(0);
  } catch {
    process.exit(0); // fail-open: never break a normal stop on a guard bug
  }
}

// Entry-point guard (same pattern as completion-report-gate.mjs): run `main()`
// only when invoked directly, so the guard-tests spec can import the pure seams
// without firing stdin reads / process.exit.
function norm(p) {
  return String(p).replace(/\\/g, "/").toLowerCase();
}
const invoked = process.argv[1] ? norm(resolve(process.argv[1])) : "";
if (invoked && invoked === norm(fileURLToPath(import.meta.url))) {
  main();
}

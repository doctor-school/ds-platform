#!/usr/bin/env node
// Stop-hook gate (#824, retro 7be667c2 F2): when the session is about to stop
// on a final assistant message that reads as a TASK-COMPLETION REPORT
// (completion verbs + PR/Issue refs) but lacks the mandatory
// «📈 % от запланированного» section, block the stop with a corrective
// message naming skill `report-task-outcome`. Canon for the report shape stays
// in `apps/docs/content/skills/report-task-outcome/SKILL.md` + memory
// `feedback_final_report_format` — this hook is only the enforcement seam.
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

/** Marker whose absence trips the gate — the «📈 % от запланированного»
 * section of skill `report-task-outcome` opens with it. */
export const REPORT_MARKER = "📈";

/** Completion verbs (RU past-participle stems + EN "merged"). A completion
 * report states that work IS merged/done — status updates, questions, and
 * handoff prompts describe work in flight and use other language. */
export const COMPLETION_VERB_RE = /смерж|выполнен|заверш[её]н|\bmerged\b/i;

/** NEGATED completion verbs (#839, PR #838 review NIT): «не смержен» /
 * "not merged" describe work still in flight, not a completion claim.
 * Matched occurrences are stripped before the completion-verb test. The
 * leading `(^|[^а-яa-zё])` stands in for a word boundary — JS `\b` is
 * ASCII-only and does not fire around Cyrillic letters. */
export const NEGATED_COMPLETION_RE =
  /(^|[^а-яa-zё])(?:не|not)\s+(?:смерж|выполнен|заверш[её]н|merged)\S*/gi;

/** PR/Issue references: `#123`, `PR 123`, `PR №123`. */
export const REF_RE = /#\d+|\bPR\s*№?\s*\d+/i;

/** Heuristic from Issue #824 (tuned by #839): completion verbs AND PR/Issue
 * refs, with negated verb forms discounted. */
export function isCompletionReport(text) {
  const t = String(text || "").replace(NEGATED_COMPLETION_RE, "$1");
  return COMPLETION_VERB_RE.test(t) && REF_RE.test(t);
}

/** Decision-request / approval-ask detector (#839): a turn that ASKS the
 * owner something is not a completion report even when it carries completion
 * verbs + refs (the observed 2026-07-13 /wrap stage-2 false positive).
 * Signals: the «ЖДУ ВАС» blocked-on-owner marker anywhere, or the last
 * non-empty line ending in a question mark (allowing trailing markdown /
 * closing punctuation). A question buried mid-report does NOT count. */
export function isDecisionRequest(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/ЖДУ ВАС/i.test(t)) return true;
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  const last = (lines[lines.length - 1] || "").trim();
  const stripped = last.replace(/[\s*_`~»"'）)\]]+$/g, "");
  return stripped.endsWith("?");
}

/**
 * The text of the LAST assistant message in a session JSONL transcript.
 * Claude Code may write one JSONL entry per content block, all sharing the
 * same `message.id` — the last assistant turn is every trailing entry with the
 * last entry's id, its text blocks concatenated. Malformed lines are skipped
 * individually. Returns null when no assistant text exists.
 */
export function extractLastAssistantText(jsonl) {
  const entries = [];
  for (const line of String(jsonl).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed);
      if (entry && entry.type === "assistant" && entry.message) {
        entries.push(entry);
      }
    } catch {
      // skip malformed line — never let one bad line kill the whole read
    }
  }
  if (entries.length === 0) return null;
  const last = entries[entries.length - 1];
  const lastId = last.message.id;
  const turn = lastId
    ? entries.filter((e) => e.message.id === lastId)
    : [last];
  const parts = [];
  for (const entry of turn) {
    const content = entry.message.content;
    if (typeof content === "string") {
      parts.push(content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block && block.type === "text" && typeof block.text === "string") {
          parts.push(block.text);
        }
      }
    }
  }
  const text = parts.join("\n").trim();
  return text || null;
}

export function blockMessage() {
  return (
    "⛔ completion-report gate (#824): the final message reads as a " +
    "task-completion report but is missing the mandatory " +
    "«📈 % от запланированного» section. Read " +
    "apps/docs/content/skills/report-task-outcome/SKILL.md (skill " +
    "report-task-outcome) and re-emit the final report in its shape — " +
    "product-first summary, «🖼 Проверить глазами», " +
    "«📈 % от запланированного», tech appendix."
  );
}

/**
 * Pure decision seam (unit-tested without a real FS): block only when this is
 * not already a post-block continuation, the last assistant message reads as a
 * completion report (not a decision-request/approval-ask — #839), and the
 * «📈» marker is absent from it.
 */
export function decideBlock({ stopHookActive, lastAssistantText }) {
  if (stopHookActive) return { block: false };
  if (!lastAssistantText) return { block: false };
  if (isDecisionRequest(lastAssistantText)) return { block: false };
  if (!isCompletionReport(lastAssistantText)) return { block: false };
  if (lastAssistantText.includes(REPORT_MARKER)) return { block: false };
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

// Entry-point guard (same pattern as main-tree-read-guard.mjs): run `main()`
// only when invoked directly, so the guard-tests spec can import the pure
// seams without firing stdin reads / process.exit.
function norm(p) {
  return String(p).replace(/\\/g, "/").toLowerCase();
}
const invoked = process.argv[1] ? norm(resolve(process.argv[1])) : "";
if (invoked && invoked === norm(fileURLToPath(import.meta.url))) {
  main();
}

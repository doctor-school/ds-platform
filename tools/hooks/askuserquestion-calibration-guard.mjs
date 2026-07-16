#!/usr/bin/env node
// PreToolUse guard (WARN-level, #940): fire a NON-BLOCKING calibration reminder
// at the exact moment the lead calls `AskUserQuestion`. Canon: memory
// `feedback_own_lead_decisions` — the owner appoints the lead to DECIDE, not to
// relay choices back up. Product taste / product scope (≥2 defensible options
// where the owner's answer changes the PRODUCT outcome) is a valid owner
// question; an engineering / architecture / impl-mechanism / token-scope /
// accuracy-vs-cost tradeoff is the LEAD's OWN call — present the candidate
// options WITH pros/cons and a reasoned decision, don't offload the choice.
// Prose alone failed 3× (the memory file records the pushbacks), so this is the
// deterministic call-site remedy. This hook is only the enforcement seam; the
// full gate lives in the memory topic file.
//
// It also runs a literal jargon lint over the question + option copy: undefined
// internal-jargon tokens (SHA, SSH, worktree, Mode-a, …) in owner-facing text
// must be spelled out ("owner-facing copy must read, not decode").
//
// Contract (Claude Code PreToolUse hook): reads the hook JSON on stdin
// ({session_id, cwd, tool_name, tool_input}). WARN = exit 0 + JSON on stdout
// ({systemMessage, hookSpecificOutput.permissionDecision:"allow"}). Because the
// calibration reminder always applies to an AskUserQuestion call, the hook emits
// on every well-formed call. FAIL-OPEN: any parse/logic error exits 0 with NO
// output — a guard bug must NEVER block a real question (WARN-level, never BLOCK).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Undefined internal-jargon tokens that must not appear un-spelled-out in
 * owner-facing option copy (seeded from Issue #940 + memory
 * `feedback_own_lead_decisions` §4 jargon-lint). Matched case-sensitively as
 * whole tokens (word-boundary-ish: not flanked by an alphanumeric on either
 * side, so `SHA` matches but `SHALL` does not; hyphenated tokens like
 * `Mode-a` / `container-tag` are matched literally). Owner-facing copy must
 * read, not decode.
 */
export const JARGON_TOKENS = [
  "SHA",
  "SSH",
  "container-tag",
  "check-runs",
  "worktree",
  "Mode-a",
  "merge:gate",
  "changeset",
];

/** The fixed calibration reminder — always emitted on an AskUserQuestion call. */
export function calibrationMessage() {
  return (
    "⚠ AskUserQuestion calibration (#940): before offloading this choice, " +
    "classify it (memory `feedback_own_lead_decisions`). PRODUCT taste / " +
    "product scope — ≥2 defensible options where the owner's answer changes " +
    "the PRODUCT outcome — is a valid owner question. But ENGINEERING / " +
    "architecture / impl-mechanism / token-scope / accuracy-vs-cost is the " +
    "LEAD's OWN call: present the candidate options WITH pros/cons and a " +
    "reasoned decision, don't hand the owner a blank multiple-choice (the " +
    "owner corrects if wrong, they don't pick for you). WARN-level only: " +
    "never blocks."
  );
}

/**
 * Collect every owner-facing copy string in an AskUserQuestion tool_input:
 * each question's `question` + `header`, and each option's `label` +
 * `description`. Shape-tolerant — missing/oddly-typed fields are skipped, never
 * throw. Returns a flat array of non-empty strings.
 */
export function collectCopy(toolInput) {
  const out = [];
  const push = (v) => {
    if (typeof v === "string" && v.trim()) out.push(v);
  };
  const questions =
    toolInput && Array.isArray(toolInput.questions) ? toolInput.questions : [];
  for (const q of questions) {
    if (!q || typeof q !== "object") continue;
    push(q.question);
    push(q.header);
    const options = Array.isArray(q.options) ? q.options : [];
    for (const o of options) {
      if (!o || typeof o !== "object") continue;
      push(o.label);
      push(o.description);
    }
  }
  return out;
}

/**
 * Literal whole-token scan of a copy string for jargon tokens. A token matches
 * when it is not flanked by an ASCII alphanumeric on either side (so `SHA`
 * fires but `SHALL` / `hashSHA` do not). Case-sensitive.
 */
export function jargonHitsIn(text, tokens = JARGON_TOKENS) {
  const hits = [];
  const s = String(text || "");
  for (const tok of tokens) {
    const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`);
    if (re.test(s)) hits.push(tok);
  }
  return hits;
}

/**
 * (#976 detector a) A restore / remediation / undo / revert / re-instate verb
 * matched in owner-facing copy. RU stems (восстанов/восстанав, откат, вернуть,
 * вернём, верни) are matched carefully so the correctness adjective «верный /
 * верно» does NOT hit; «отмена» (product cancellation) is deliberately excluded.
 */
const RESTORE_VERB_RE =
  /(восстан[ао]в|откат|вернуть|верн[её]м|верни(?:те)?|remediat|\brestore|\brestoring\b|\bundo\b|\brevert|re-?instat|reinstat|rollback|roll\s+back)/i;

/**
 * (#976 detector a) A scope / extent cue — the signal that a restore verb is
 * about the SCOPE of restoring a mistake (a lead call), not a product feature
 * that merely mentions "restore" (e.g. a password-recovery flow).
 */
// NB: JS `\b` is ASCII-only (Cyrillic is not `\w`), so RU cues carry no `\b` —
// only the ASCII (EN) cues do.
const RESTORE_SCOPE_CUE_RE =
  /(\bscope\b|объ[её]м|сколько|только|весь|всё|целиком|полност|частичн|how\s+much|\bentire\b|\bwhole\b|\bpartial|\bextent\b|\bonly\b|\bfull(?:y)?\b)/i;

/**
 * (#976 detector b) A reference to a live surface: a slash-route (`/account`),
 * a source filename (`foo.tsx`), or a surface noun (страница / page / endpoint /
 * route / маршрут / экран / screen).
 */
const SURFACE_REF_RE =
  /(?:(?:^|[\s("'«`>[])\/[a-zа-я][\w/-]*)|(?:\b[\w-]+\.(?:tsx?|jsx?|mjs|cjs|css|scss|json|ya?ml|md|vue|py|go|rs|sql|html?)\b)|(?:страниц|\bpage\b|endpoint|\broute\b|маршрут|экран|\bscreen\b|роут)/i;

/**
 * (#976 detector b) An asserted-state predicate binding a subject to a claimed
 * state (is / это / = / returns / renders / содержит / является), or a
 * loaded state-noun (dump / дамп / stub / заглушк / сырой). Kept tight so a
 * product "which page to route to" pick (no assertion) does not match.
 */
// RU verb forms carry no `\b` (ASCII-only in JS). `это` is deliberately NOT a
// predicate here — it is indistinguishable from the demonstrative «этой/этот»
// and would false-positive; the loaded state-nouns (сырой / дамп / заглушк)
// carry the real "asserted state" signal instead.
const STATE_PREDICATE_RE =
  /(\bis\b|\bare\b|\bwas\b|\bwere\b|является|представляет\s+собой|\breturns?\b|\brenders?\b|содержит|\bstub\b|заглушк|\bdump\b|дамп|сыр(?:ой|ая|ое|ые))/i;

/**
 * (#976 detector a) True when any single owner-facing copy string frames a
 * restore/remediation SCOPE decision — a restore verb AND a scope cue in the
 * SAME string. Same-string pairing keeps it conservative: a product question
 * that merely contains "восстановление" (in the question) with an unrelated
 * "только" (in an option) does NOT fire. Never throws.
 */
export function restoreScopeHit(copies) {
  try {
    const list = Array.isArray(copies) ? copies : [];
    return list.some(
      (c) =>
        typeof c === "string" &&
        RESTORE_VERB_RE.test(c) &&
        RESTORE_SCOPE_CUE_RE.test(c),
    );
  } catch {
    return false;
  }
}

/**
 * (#976 detector b) True when any single owner-facing copy string asserts an
 * unverified factual claim about a live surface — a surface reference AND an
 * asserted-state predicate in the SAME string. Per-string pairing avoids
 * false-pairing a surface noun in one option with a predicate in another.
 * Never throws.
 */
export function surfaceClaimHit(copies) {
  try {
    const list = Array.isArray(copies) ? copies : [];
    return list.some(
      (c) =>
        typeof c === "string" &&
        SURFACE_REF_RE.test(c) &&
        STATE_PREDICATE_RE.test(c),
    );
  } catch {
    return false;
  }
}

/**
 * Pure decision seam (unit-tested without a real FS / process): given the
 * parsed AskUserQuestion `tool_input`, return the calibration `systemMessage`
 * (always present for a well-formed call — even an empty/malformed input still
 * gets the reminder) and the sorted, de-duplicated list of jargon hits found in
 * the owner-facing copy. When jargon is present, a WARN line naming the tokens
 * is appended. Two further #976 advisories append when the copy frames a
 * restore/remediation-scope decision (a lead call) or asserts an unverified
 * live-surface state claim (verify against source first). NEVER throws.
 */
export function evaluateAskUserQuestion(toolInput, tokens = JARGON_TOKENS) {
  let message = calibrationMessage();
  const hitSet = new Set();
  let copies = [];
  try {
    copies = collectCopy(toolInput);
    for (const copy of copies) {
      for (const hit of jargonHitsIn(copy, tokens)) hitSet.add(hit);
    }
  } catch {
    // fail-open: a jargon-scan bug must never suppress the calibration reminder
  }
  const jargonHits = [...hitSet].sort();
  if (jargonHits.length > 0) {
    message +=
      `\n⚠ jargon lint (#940): owner-facing option copy contains undefined ` +
      `internal jargon — ${jargonHits.join(", ")}. Spell it out: owner-facing ` +
      `copy must read, not decode.`;
  }
  const restoreScope = restoreScopeHit(copies);
  if (restoreScope) {
    message +=
      `\n⚠ restore/remediation-scope (#976): this frames the SCOPE of restoring ` +
      `an erroneously deleted/broken artifact as an owner menu. Restoring a ` +
      `mistake is the LEAD's call — do a minimal-diff, faithful, FULL restore ` +
      `and resolve it inline; don't ask the owner to pick a restore scope.`;
  }
  const surfaceClaim = surfaceClaimHit(copies);
  if (surfaceClaim) {
    message +=
      `\n⚠ live-surface claim (#976): an option/question asserts an unverified ` +
      `state claim about a live surface (a route / page / endpoint). Verify it ` +
      `against SOURCE first — a wrong premise makes the whole question invalid.`;
  }
  return { systemMessage: message, jargonHits, restoreScope, surfaceClaim };
}

function main() {
  try {
    const payload = JSON.parse(readFileSync(0, "utf8"));
    const { systemMessage } = evaluateAskUserQuestion(payload.tool_input);
    process.stdout.write(
      JSON.stringify({
        systemMessage,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: systemMessage,
        },
      }),
    );
    process.exit(0);
  } catch {
    process.exit(0); // fail-open: never block a real question on a guard bug
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

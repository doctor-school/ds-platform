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
 * section of skill `report-task-outcome` opens with it. The presence check is a
 * plain `.includes(REPORT_MARKER)` substring test, so markdown emphasis /
 * heading wrappers around the marker (`**📈 …**`, `## 📈 …`) are tolerated
 * inherently — the 📈 codepoint is present regardless of the wrapper (#893). */
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

/** Interim-status recognizer (#855): a mid-wave checkpoint / in-flight status
 * turn can carry a SUB-STEP completion verb + a ref (e.g. «Checkpoint: #828
 * смержен в ветку, жду CI») and thus trip `isCompletionReport`, even though it
 * is NOT a terminal task-completion report. This marker set fires ONLY on
 * genuine in-flight language (RU+EN, case-insensitive) and never on a settled
 * completion report — so the gate exempts such turns before the report test. */
export const INTERIM_STATUS_RE =
  /⏳|\bcheckpoint\b|чекпоинт|\bprobe\b|\bWIP\b|в процессе|в работе|жду вердикт|жду CI|жду ревью|ещё не смерж|ещё не заверш|ничего (?:ещё )?не смерж|не финализир|не\s+завершающ|промежуточн[а-яё]*\s+статус|\b0\s*\/\s*\d/i;

/** Opening-anchored interim markers (#990): «интерим»/"interim" and
 * "in flight"/"in-flight" are common words a GENUINE completion report may
 * legitimately use mid-body («…the interim fix shipped…»), so unlike the
 * unambiguous full-text set above they count as an explicit interim signal
 * ONLY inside the message OPENING slice (first ~INTERIM_OPENING_SLICE chars) —
 * the Issue-#990 marker semantics are an explicit signal at the opening, and
 * anchoring keeps a mid-body mention from silently exempting a real report.
 * The leading `(^|[^а-яa-zё])` stands in for a word boundary — JS `\b` is
 * ASCII-only and does not fire around Cyrillic letters (cf.
 * NEGATED_COMPLETION_RE). */
export const INTERIM_OPENING_RE =
  /(^|[^а-яa-zё])(?:интерим|interim\b|in[\s-]flight\b)/i;

/** Size of the opening slice the #990 opening-anchored markers apply to. */
export const INTERIM_OPENING_SLICE = 200;

/** True when the turn reads as an in-flight checkpoint / status rather than a
 * terminal completion report (#855): an unambiguous full-text interim marker
 * anywhere, or an opening-anchored #990 marker in the first
 * INTERIM_OPENING_SLICE chars. */
export function isInterimStatus(text) {
  const t = String(text || "");
  if (INTERIM_STATUS_RE.test(t)) return true;
  return INTERIM_OPENING_RE.test(t.slice(0, INTERIM_OPENING_SLICE));
}

/** Proposal / work-in-flight recognizer (#962). The #855 interim-status set is
 * an explicit-marker whitelist (⏳/checkpoint/WIP/…); it missed two live false
 * fires (session 21b928cf ×2) where the turn used natural status prose without
 * those markers yet still carried sub-step completion verbs + refs and thus
 * tripped `isCompletionReport`:
 *   1. a mid-flight WAVE STATUS — a merged-bullet list of already-landed
 *      sub-steps FOLLOWED by starting the next dispatch / an in-flight subagent
 *      («приступаю к…», «субагент ещё работает», «жду возврата»);
 *   2. a /wrap PROPOSAL — proposing to START the wrap loop with a merged-bullet
 *      summary («предлагаю запустить /wrap», «приступаю к стадии»).
 * Both frame work as still in motion / a next action being PROPOSED, not the
 * task being closed. This set keys ONLY on first-person proposal / in-flight
 * FRAMING verbs (RU+EN, case-insensitive) — never on the bare words
 * «дальше»/"next", so a genuine terminal report's «что дальше» handoff section
 * does NOT match and the gate keeps firing on it (the #962 regression guard).
 * Only PRESENT/GERUND in-flight forms are matched — the PAST-tense completed
 * forms ("dispatched" / «диспатчил») are deliberately EXCLUDED, because a
 * genuine terminal report's tech appendix legitimately narrates completed
 * sub-steps ("dispatched 3 subagents, all merged") and must still fire. */
export const PROPOSAL_INFLIGHT_RE =
  /предлага[ею]|\bpropos(?:e|es|ing)\b|приступа[ею]|собира[ею](?:сь|шься)|\babout to\b|\bproceeding\b|диспатчир(?:ую|уешь)|\bdispatching\b|субагент\w*\s+(?:ещё\s+)?(?:работает|в\s+работе|бежит|running)|\bsubagent[s]?\s+(?:still\s+)?(?:running|working)\b|в\s+пол[её]те|жду\s+возврат\w*|запуска[ею]\s+\/?wrap/i;

/** True when the turn PROPOSES a next action or reports work still in flight
 * rather than closing the task (#962) — a merged-bullet summary is still not a
 * terminal completion report when the frame is "starting the next thing". */
export function isProposalOrInFlight(text) {
  return PROPOSAL_INFLIGHT_RE.test(String(text || ""));
}

/** DoD-vs-title enforcement (#984, retro b9d9314e finding B). A wrap/handoff/
 * "done" completion report whose REMAINING / next-steps list still carries the
 * session's own release-class action (release / deploy / publish / ship + RU
 * релиз/деплой/публик/шип/выкат) is punting the very step the task titled it to
 * do — a DoD-vs-title mismatch. The signal is read PURELY from the report TEXT
 * (no gh / network / spawn — this is a fail-open Stop hook that must stay fast,
 * consistent with #824's pure-transcript-seam architecture): the refusal fires
 * UNLESS the report's own text evidences a release/deploy artifact. */

/** Markers that open a REMAINING / next-steps region (RU+EN). */
export const REMAINING_MARKER_RE =
  /остал\w*|остаётся|остаток|не\s+сделан\w*|предстоит|надо\s+ещ[её]|нужно\s+ещ[её]|\bTODO\b|\bremaining\b|\bnext step/i;

/** Release-class action verbs/stems (RU+EN), each anchored on a LEADING word
 * boundary. JS `\b` is ASCII-only and does not fire around Cyrillic, so the RU
 * stems (`депло`/`релиз`/`публик`/`шип`/`выкат`) use the file's own
 * `(^|[^а-яёa-z])` boundary idiom (cf. NEGATED_COMPLETION_RE) — this stops a
 * mid-word Cyrillic hit like «рес·публик·и» (republic) or an EN mid-word hit
 * like "member·ship" from tripping the gate (#991 review NIT 2). RU roots stay
 * broad enough to cover the verb forms — «деплой»/«деплоить»/«задеплоить» share
 * the «депло» stem; «релиз»/«релизить»/«зарелизить» share «релиз». */
export const RELEASE_VERB_RE =
  /(?:^|[^а-яёa-z])(?:publish\w*|releas\w*|deploy\w*|ship\w*|(?:за)?депло\w*|(?:за)?релиз\w*|(?:о)?публик\w*|выкат\w*|шип\w*)/i;

/** A `release-YYYY.MM.DD[-n]` tag pattern — direct release-artifact evidence. */
export const RELEASE_TAG_RE = /release-\d{4}\.\d{2}\.\d{2}(?:-\d+)?/i;

/** COMPLETED-state deploy evidence — the PAST-PARTICIPLE / past-tense forms
 * «задеплоен(а/о/ный)…» / «задеплоил(и)…» / "deployed" / "deployment". These
 * are deliberately kept DISJOINT from the infinitive/imperative punt forms
 * («задеплоить» / «deploy X» / «ship»): «задеплоен…» and «задеплоил…» never
 * match «задеплоить» (the 8th char diverges е/л vs и), so evidence cannot be
 * satisfied by the very deferred verb that triggered the block (#991 BLOCKER —
 * the old `DEPLOY_WORD_RE && SHA_RE` clause self-defeated: its deploy-stem
 * matched the punted «задеплоить», so any stray 7+ hex token silently exempted
 * the finding-B case). */
export const DEPLOYED_EVIDENCE_RE =
  /задеплоен\w*|задеплоил\w*|\bdeployed\b|\bdeployment\b/i;

/**
 * True when the report's own text evidences a COMPLETED release/deploy artifact
 * for this session: a `release-YYYY.MM.DD` tag, or a completed-form deploy
 * mention («задеплоен»/«задеплоил»/"deployed"/Deployment). Signals that collide
 * with the deferred/infinitive verb (a bare deploy-stem + a sha) are NOT used —
 * they would auto-exempt the exact punt this gate must catch. Presence anywhere
 * in the report exempts the DoD refusal (the release actually happened).
 * @param {string} text
 */
export function hasReleaseArtifactEvidence(text) {
  const t = String(text || "");
  if (RELEASE_TAG_RE.test(t)) return true;
  if (DEPLOYED_EVIDENCE_RE.test(t)) return true;
  return false;
}

/**
 * True when a release-class verb appears inside a REMAINING / next-steps region
 * — either on a marker line itself («Осталось: задеплоить в прод») or on a
 * bullet / numbered / indented continuation line under a marker heading
 * («## Осталось\n- задеплоить …»). A release verb elsewhere (a done-statement,
 * a description of the deliverable) does NOT count — the finding is specifically
 * the verb being PUNTED into "remaining".
 * @param {string} text
 */
export function hasDeferredReleaseVerb(text) {
  const lines = String(text || "").split(/\r?\n/);
  let inRemaining = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (REMAINING_MARKER_RE.test(line)) {
      if (RELEASE_VERB_RE.test(line)) return true;
      inRemaining = true;
      continue;
    }
    if (!inRemaining) continue;
    if (trimmed === "") {
      inRemaining = false;
      continue;
    }
    const isContinuation =
      /^[-*•]/.test(trimmed) || /^\d+[.)]/.test(trimmed) || /^\s/.test(line);
    if (isContinuation) {
      if (RELEASE_VERB_RE.test(line)) return true;
      continue;
    }
    inRemaining = false; // a non-blank, non-bullet line ends the remaining block
  }
  return false;
}

/**
 * Combined DoD-vs-title predicate (#984): a completion report punts its own
 * release-class step into "remaining" AND shows no release/deploy artifact.
 * @param {string} text
 */
export function refusesDeferredRelease(text) {
  return hasDeferredReleaseVerb(text) && !hasReleaseArtifactEvidence(text);
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
  const turn = lastId ? entries.filter((e) => e.message.id === lastId) : [last];
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

/** DoD-vs-title refusal message (#984): distinct from the missing-📈 message —
 * a completion report punting its own titled release/deploy step. */
export function deferredReleaseMessage() {
  return (
    "⛔ completion-report gate (#984, DoD-vs-title): the final message reads as a " +
    "completion/wrap report, yet its REMAINING / next-steps list still carries the " +
    "session's own release-class action (release / deploy / publish / ship / релиз / " +
    "деплой / публикация / выкат) while the report shows NO release/deploy artifact " +
    "(no `release-YYYY.MM.DD` tag, no Deployment + sha, no «задеплоен»/«deployed»). " +
    "Either FINISH the release/deploy and cite the artifact in the report, or move it " +
    "out of «remaining» as a genuinely separate, tracked follow-up with recorded " +
    "evidence — a session must not report done while punting its own titled release " +
    "step. Canon: skill report-task-outcome; run-prod-deploy."
  );
}

/**
 * Pure decision seam (unit-tested without a real FS): block only when this is
 * not already a post-block continuation, the last assistant message reads as a
 * completion report — not a decision-request/approval-ask (#839), not an
 * in-flight checkpoint / interim status (#855), and not a proposal / work-still-
 * in-flight turn (#962). Two escalations then apply: the DoD-vs-title refusal
 * (#984 — a report punting its own titled release/deploy step with no artifact
 * evidence, blocked EVEN WITH the «📈» marker present), then the original #824
 * missing-«📈» block.
 */
export function decideBlock({ stopHookActive, lastAssistantText }) {
  if (stopHookActive) return { block: false };
  if (!lastAssistantText) return { block: false };
  if (isDecisionRequest(lastAssistantText)) return { block: false };
  if (isInterimStatus(lastAssistantText)) return { block: false };
  if (isProposalOrInFlight(lastAssistantText)) return { block: false };
  if (!isCompletionReport(lastAssistantText)) return { block: false };
  // #984 DoD-vs-title: refuse a report that punts its own release/deploy step
  // with no artifact evidence — this fires even when «📈» IS present.
  if (refusesDeferredRelease(lastAssistantText)) return { block: true };
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
      const msg = refusesDeferredRelease(lastAssistantText)
        ? deferredReleaseMessage()
        : blockMessage();
      process.stderr.write(msg);
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

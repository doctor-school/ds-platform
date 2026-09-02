#!/usr/bin/env node
// PreToolUse guard (#1746): `/wrap` is OWNER-initiated only.
//
// Why: the owner found leads starting the end-of-session wrap on their own —
// at a wave's end, «before a long gap», or in answer to a plain handoff request
// — and learned of it only later (the owner does not always watch the session).
// A wrap dispatches a fresh-context retro agent over the whole session log, the
// single most expensive step a session can take; that decision is the owner's.
//
// Contract (Claude Code PreToolUse, matcher `Agent|Task|Read|Skill`): stdin JSON
// carries {session_id, transcript_path, tool_name, tool_input, agent_id?}.
// A WRAP-INITIATION step — `Read` of the run-wrap / run-session-retro skill,
// an Agent/Task dispatch whose brief names the session retro, or `Skill`
// wrap / run-wrap / wrap-init — is DENIED (permissionDecision "deny") unless
// the session transcript holds an OWNER user entry carrying `/wrap` (a typed
// slash command lands as `<command-name>/wrap</command-name>`; plain owner
// text with the token `/wrap` counts too). Only string content / `text`
// blocks of `type:"user"` entries are read — `tool_result` blocks are tool
// output (this guard's own deny reason included), never the owner's words.
// Every other tool call exits silently before the transcript is touched.
// Subagents (`agent_id` present) are exempt. FAIL-OPEN: any error exits 0 —
// a guard bug must never wedge a legitimate tool call.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WRAP_SKILL_NAMES = new Set(["wrap", "run-wrap", "wrap-init"]);

/** Skill files whose `Read` opens the wrap procedure or its retro stage. */
export const WRAP_SKILL_PATH_RE =
  /skills\/(?:run-wrap|run-session-retro)\/SKILL\.md$/i;

/** A dispatch brief that names the session retro (stage 1 of run-wrap). */
export const RETRO_DISPATCH_RE =
  /run-session-retro|session[- ]retro|retro[- ]agent|ретро\s+сесси|ретро-агент/i;

/** The owner's own `/wrap` (or `/wrap-init`): a typed slash command as Claude
 * Code records it, or the bare token in free owner text. */
export const OWNER_WRAP_RE =
  /<command-name>\/wrap(?:-init)?<\/command-name>|(?:^|\s)\/wrap(?:-init)?(?=\s|$)/m;

export function isWrapInitiation(toolName, toolInput) {
  const input = toolInput && typeof toolInput === "object" ? toolInput : {};
  if (toolName === "Skill") {
    return WRAP_SKILL_NAMES.has(
      String(input.skill || "")
        .trim()
        .toLowerCase(),
    );
  }
  if (toolName === "Read") {
    return WRAP_SKILL_PATH_RE.test(
      String(input.file_path || "").replace(/\\/g, "/"),
    );
  }
  if (toolName === "Agent" || toolName === "Task") {
    const text = [input.prompt, input.description]
      .filter((v) => typeof v === "string")
      .join("\n");
    return RETRO_DISPATCH_RE.test(text);
  }
  return false;
}

/** Owner-authored text of one transcript entry — `null` for anything else. */
export function ownerText(entry) {
  if (!entry || entry.type !== "user" || !entry.message) return null;
  const content = entry.message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts = [];
  for (const block of content) {
    if (block && block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.length ? parts.join("\n") : null;
}

export function ownerRequestedWrap(jsonl) {
  for (const line of String(jsonl || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("/wrap")) continue; // cheap pre-filter
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const text = ownerText(entry);
    if (text && OWNER_WRAP_RE.test(text)) return true;
  }
  return false;
}

export function decide({ toolName, toolInput, jsonl }) {
  if (!isWrapInitiation(toolName, toolInput)) return { action: "silent" };
  if (ownerRequestedWrap(jsonl)) return { action: "silent" };
  return { action: "deny" };
}

export function denyMessage(toolName) {
  return (
    `⛔ wrap-owner-only (#1746): /wrap запускает только владелец, а в транскрипте ` +
    `этой сессии его команды /wrap нет — шаг «${toolName}» открывает wrap/ретро ` +
    `и заблокирован. Просьба о handoff = skill handoff-prompt: только промпт, ` +
    `без ретро и без правок инструкций. Для wrap ничего не делай; если владелец ` +
    `хочет ретро, он введёт /wrap сам.`
  );
}

function main() {
  try {
    const payload = JSON.parse(readFileSync(0, "utf8"));
    if (payload.agent_id) process.exit(0);
    if (!isWrapInitiation(payload.tool_name, payload.tool_input)) {
      process.exit(0);
    }
    const transcriptPath = payload.transcript_path;
    if (typeof transcriptPath !== "string" || !transcriptPath) process.exit(0);
    const decision = decide({
      toolName: payload.tool_name,
      toolInput: payload.tool_input,
      jsonl: readFileSync(transcriptPath, "utf8"),
    });
    if (decision.action !== "deny") process.exit(0);
    const msg = denyMessage(payload.tool_name);
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
  } catch {
    process.exit(0); // fail-open: never wedge a legitimate tool call on a bug
  }
}

function norm(p) {
  return String(p).replace(/\\/g, "/").toLowerCase();
}
const invoked = process.argv[1] ? norm(resolve(process.argv[1])) : "";
if (invoked && invoked === norm(fileURLToPath(import.meta.url))) {
  main();
}

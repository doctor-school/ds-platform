#!/usr/bin/env node
/** /wrap is owner-initiated. Claude Read/Skill/Agent/Task plus Codex spawn_agent
 * and recognized shell skill reads are gated. Owner text supports Claude user
 * entries and Codex user_message events / response_item user input_text,
 * never tool outputs or assistant text.
 * Relevant wrap without readable authorization is denied. Legacy Claude child
 * exemption remains; arbitrary shell/JS semantics are not exhaustively parsed. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  shellCommand,
  normalizeToolName,
  isNewDispatchTool,
} from "./hook-compat.mjs";

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
  if (
    isNewDispatchTool(toolName) ||
    normalizeToolName(toolName) === "followup_task"
  ) {
    const text = [input.prompt, input.description, input.message]
      .filter((v) => typeof v === "string")
      .join("\n");
    return RETRO_DISPATCH_RE.test(text);
  }
  if (/^(Bash|exec_command)$/.test(toolName)) {
    const command = String(shellCommand(input) || "").replace(/\\/g, "/");
    return /(?:Get-Content|cat|type|readFileSync|readFile)\b[^\n]*skills\/(?:run-wrap|run-session-retro)\/SKILL\.md/i.test(
      command,
    );
  }
  return false;
}

/** Owner-authored text of one transcript entry — `null` for anything else. */
export function ownerText(entry) {
  if (entry?.type === "event_msg" && entry?.payload?.type === "user_message") {
    return typeof entry.payload.message === "string"
      ? entry.payload.message
      : null;
  }
  if (entry?.type === "response_item" && entry?.payload?.role === "user") {
    const content = entry.payload.content;
    if (!Array.isArray(content)) return null;
    const parts = content
      .filter(
        (block) =>
          block?.type === "input_text" && typeof block.text === "string",
      )
      .map((block) => block.text);
    return parts.length ? parts.join("\n") : null;
  }
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
    `хочет ретро, он может написать обычное сообщение: «Проведи /wrap для этой сессии.». ` +
    `Отдельная slash-команда /wrap в Codex может быть не зарегистрирована.`
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
    let jsonl = "";
    try {
      if (typeof transcriptPath === "string")
        jsonl = readFileSync(transcriptPath, "utf8");
    } catch {
      /* Missing evidence cannot authorize wrap. */
    }
    const decision = decide({
      toolName: payload.tool_name,
      toolInput: payload.tool_input,
      jsonl,
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

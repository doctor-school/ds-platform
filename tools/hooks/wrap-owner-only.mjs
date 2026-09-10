#!/usr/bin/env node
/** Workflow execution is owner-initiated. Skill/Agent/Task and Codex dispatch
 * are gated by action; documentation reads are not execution. Owner text supports Claude user
 * entries and Codex user_message events / response_item user input_text,
 * never tool outputs or assistant text.
 * Relevant wrap without readable authorization is denied. Legacy Claude child
 * exemption remains; arbitrary shell/JS semantics are not exhaustively parsed. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeToolName, isNewDispatchTool } from "./hook-compat.mjs";

export const WRAP_SKILL_NAMES = new Set(["wrap", "run-wrap", "wrap-init"]);

/** A dispatch brief that names the session retro (stage 1 of run-wrap). */
export const RETRO_DISPATCH_RE =
  /run-session-retro|session[- ]retro|retro[- ]agent|ретро\s+сесси|ретро-агент/i;

/** The owner's own `/wrap` (or `/wrap-init`): a typed slash command as Claude
 * Code records it, or the bare token in free owner text. */
export const OWNER_WRAP_RE =
  /<command-name>\/wrap(?:-init)?<\/command-name>|(?:^|\s)\/wrap(?:-init)?(?=\s|$)/m;

/** Classify explicit workflow invocations; inspecting documentation is not execution. */
export function workflowKind(toolName, toolInput) {
  const input = toolInput && typeof toolInput === "object" ? toolInput : {};
  if (toolName === "Skill") {
    const name = String(input.skill || "")
      .trim()
      .toLowerCase();
    if (WRAP_SKILL_NAMES.has(name)) return "wrap";
    return name === "run-session-retro" ? "retro" : null;
  }
  if (
    isNewDispatchTool(toolName) ||
    normalizeToolName(toolName) === "followup_task"
  ) {
    const text = [input.prompt, input.description, input.message]
      .filter((v) => typeof v === "string")
      .join("\n");
    if (/\brun-wrap\b|(?:^|\s)\/wrap(?:-init)?(?=\s|$)/i.test(text))
      return "wrap";
    if (RETRO_DISPATCH_RE.test(text)) return "retro";
  }
  return null;
}

export function isWrapInitiation(toolName, toolInput) {
  return workflowKind(toolName, toolInput) !== null;
}

/** Owner-authored text of one transcript entry — `null` for anything else. */
export function ownerText(entry) {
  if (entry?.isMeta || entry?.isCompactSummary) return null;
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

/** Conservative request grammar, not a natural-language authorization engine.
 * Strip quoted examples and known injected context before recognizing imperatives. */
function requestText(text) {
  if (
    /^\s*#\s*(?:AGENTS\.md instructions|Agent bootstrap)|^\s*You are continuing/im.test(
      text,
    )
  )
    return "";
  return text
    .replace(
      /<(?:environment_context|INSTRUCTIONS|system-reminder|task-notification)\b[^>]*>[\s\S]*?<\/(?:environment_context|INSTRUCTIONS|system-reminder|task-notification)>/gi,
      "",
    )
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, "")
    .replace(/^\s*>.*$/gm, "")
    .replace(/`[^`]*`|"[^"\n]*"|«[^»]*»|“[^”]*”/g, "");
}

function ownerRequested(jsonl, kind) {
  for (const line of String(jsonl || "").split(/\r?\n/)) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const raw = ownerText(entry);
    if (!raw) continue;
    const text = requestText(raw);
    if (
      kind === "wrap" &&
      /^\s*<command-name>\/wrap(?:-init)?<\/command-name>/m.test(text)
    )
      return true;
    for (const candidate of text.split(/\r?\n/)) {
      const request = candidate.trim();
      if (kind === "wrap" && /^\/wrap(?:-init)?[.!]?$/i.test(request))
        return true;
      // The verb must directly target the workflow, not a check or discussion of it.
      const target = request.match(
        /^(?:(?:please|ok(?:ay)?|окей|пожалуйста)[, .]+)*(?:run|perform|conduct|do|проведи|сделай|давай|запусти)\s+(?:(?:a|the|full|полный|полноценный|поноценный|независимый)\s+)?(.+)$/i,
      )?.[1];
      if (!target) continue;
      if (kind === "wrap" && /^\/wrap(?:-init)?(?=\s|[.!]?$)/i.test(target))
        return true;
      if (
        kind === "retro" &&
        /^(?:session retro|retrospective|run-session-retro|ретро)(?=\s|[.!]?$)/i.test(
          target,
        )
      )
        return true;
    }
  }
  return false;
}

export function ownerRequestedWrap(jsonl) {
  return ownerRequested(jsonl, "wrap");
}

export function decide({ toolName, toolInput, jsonl }) {
  const kind = workflowKind(toolName, toolInput);
  if (!kind || ownerRequestedWrap(jsonl)) return { action: "silent" };
  if (kind === "retro" && ownerRequested(jsonl, "retro"))
    return { action: "silent" };
  return { action: "deny" };
}

export function denyMessage(toolName) {
  return (
    `wrap-owner-only (#2155): ${toolName} requests a workflow without readable owner authorization. ` +
    `Standalone retro needs an explicit analysis request; full wrap needs the owner's /wrap ` +
    `(for example: Проведи /wrap для этой сессии.). ` +
    `A handoff request uses handoff-prompt only. Documentation reads need neither. ` +
    `Analysis consent does not authorize instruction or memory edits.`
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

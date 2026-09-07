import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve, win32, posix } from "node:path";

/** Only supported collaboration aliases: dotted tool API names and compact
 * names observed in host hook payloads. Unknown namespaces stay unchanged. */
export function normalizeToolName(value) {
  const name = String(value || "");
  return name.replace(
    /^collaboration\.?((?:spawn_agent|followup_task))$/,
    "$1",
  );
}
export const DISPATCH_TOOL_RE = /^(Agent|Task|spawn_agent)$/;
export function isNewDispatchTool(value) {
  return DISPATCH_TOOL_RE.test(normalizeToolName(value));
}

export function isPortableAbsolute(value) {
  const p = String(value || "");
  return /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\/.test(p) || p.startsWith("/");
}
export function absolutePath(value, cwd) {
  const api =
    /^[a-zA-Z]:[\\/]/.test(value) || /^[a-zA-Z]:[\\/]/.test(cwd)
      ? win32
      : posix;
  return api.resolve(cwd, value);
}
/** Resolve existing ancestors too: a newly added file can escape through a junction. */
export function canonicalPath(value) {
  let parent = resolve(value);
  const tail = [];
  while (!existsSync(parent)) {
    const up = dirname(parent);
    if (up === parent) return resolve(value);
    tail.unshift(parent.slice(up.length).replace(/^[\\/]/, ""));
    parent = up;
  }
  return join(realpathSync(parent), ...tail);
}
export function actorIdentity(payload) {
  // Codex subagents share the parent's session_id. Never share mutable latches.
  return createHash("sha256")
    .update(
      JSON.stringify([
        payload?.session_id || "unknown",
        payload?.agent_id || "lead",
        payload?.transcript_path || "",
      ]),
    )
    .digest("hex")
    .slice(0, 24);
}
export function shellCommand(input) {
  return typeof input === "string" ? input : (input?.command ?? input?.cmd);
}
export function projectRoot(payload, env = process.env, exec = execFileSync) {
  const explicit = env.CLAUDE_PROJECT_DIR || env.CODEX_PROJECT_DIR;
  if (!payload?.cwd && explicit) return explicit;
  const cwd = payload?.cwd || process.cwd();
  // A stale vendor env inherited from a lead must not pin its child to main.
  try {
    return String(
      exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      }),
    ).trim();
  } catch {
    return env.CLAUDE_PROJECT_DIR || env.CODEX_PROJECT_DIR || cwd;
  }
}
/** Canonical Codex input is {command}; the other forms are defensive adapters. */
export function patchPaths(toolInput, cwd) {
  const command =
    typeof toolInput === "string"
      ? toolInput
      : (toolInput?.command ?? toolInput?.patch);
  if (typeof command !== "string")
    throw new Error("unparseable apply_patch payload");
  const lines = command.trim().split(/\r?\n/);
  if (lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch")
    throw new Error("invalid patch envelope");
  const paths = new Set();
  for (const line of lines.slice(1, -1)) {
    if (!line.startsWith("*** ")) continue;
    const match =
      /^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (\S.*)$/.exec(line);
    if (match) {
      const raw = match[1].trim();
      if (!raw || /[\0\r\n]/.test(raw) || /^[A-Za-z]:[^\\/]/.test(raw))
        throw new Error("ambiguous patch target");
      paths.add(absolutePath(raw, cwd));
    } else if (line !== "*** End of File")
      throw new Error("unparseable patch header");
  }
  if (!paths.size) throw new Error("patch has no file targets");
  return [...paths];
}
export function mutationPaths(toolName, toolInput, cwd) {
  if (toolName === "apply_patch") return patchPaths(toolInput, cwd);
  const filePath = toolInput?.file_path;
  if (typeof filePath !== "string" || !filePath.trim())
    throw new Error("mutation has no file_path");
  return [absolutePath(filePath, cwd)];
}
export function telemetryUnavailable(kind) {
  return {
    systemMessage: `${kind} context telemetry unavailable; token cap is not verified. Follow the documented wave/rotation limits manually.`,
  };
}

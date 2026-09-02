import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

function isPortableAbsolute(value) {
  const p = String(value || "");
  return /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\/.test(p) || p.startsWith("/");
}

/** Resolve the repository root without assuming a vendor-specific env var. */
export function projectRoot(payload, env = process.env, exec = execFileSync) {
  const explicit = env.CLAUDE_PROJECT_DIR || env.CODEX_PROJECT_DIR;
  if (explicit) return explicit;
  const cwd = payload?.cwd || process.cwd();
  try {
    return String(
      exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
      }),
    ).trim();
  } catch {
    return cwd;
  }
}

/** Paths named by a Codex apply_patch command. */
export function patchPaths(toolInput, cwd) {
  const command = toolInput?.command;
  if (typeof command !== "string") return [];
  const paths = [];
  const seen = new Set();
  const re = /^\*\*\* (?:(?:Add|Update|Delete) File|Move to):\s+(.+)$/gm;
  for (const match of command.matchAll(re)) {
    const raw = match[1].trim();
    const value = isPortableAbsolute(raw) ? raw : resolve(cwd, raw);
    if (!seen.has(value)) {
      seen.add(value);
      paths.push(value);
    }
  }
  return paths;
}

/** All file targets for Claude Edit/Write or Codex apply_patch payloads. */
export function mutationPaths(toolName, toolInput, cwd) {
  if (toolName === "apply_patch") return patchPaths(toolInput, cwd);
  const filePath = toolInput?.file_path;
  if (typeof filePath !== "string" || !filePath) return [];
  return [isPortableAbsolute(filePath) ? filePath : resolve(cwd, filePath)];
}

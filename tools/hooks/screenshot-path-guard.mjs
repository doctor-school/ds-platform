#!/usr/bin/env node
// PreToolUse guard on the Playwright-MCP screenshot tool (#1169).
//
// `browser_take_screenshot` resolves a RELATIVE `filename` against the MCP
// server's own cwd — which is the repository root. A bare name therefore drops
// the PNG straight into the SHARED main tree: 18 stray files (5.8 MB) were
// found at root on 2026-08-03, from 73 bare-filename calls across the project's
// session transcripts. `.gitignore` (`/*.png`, #374) stops them reaching git,
// but nothing stopped them being written.
//
// The rule already existed in auto-memory
// (`reference_ds_platform_dev_stand_recipe.md` → "Playwright MCP screenshots":
// always pass an ABSOLUTE filename, never a bare relative one — #346/#365/#370)
// and never reached the call site: auto-memory is load-on-demand, and a
// dispatched subagent — which is where browser payloads run
// (`.claude/rules/dev-stand.md`) — does not inherit the lead's memory at all.
// So the rule is enforced here, at the tool call, where it applies to lead and
// subagent alike.
//
// An OMITTED `filename` is allowed: the server then names the file itself and
// writes it under its own output dir, never the repo root.
//
// Contract: reads the PreToolUse hook JSON on stdin ({session_id, cwd,
// tool_name, tool_input:{filename}}). Exit 2 + stderr = BLOCK. Exit 0 = allow.
// FAIL-OPEN: any parse/logic error exits 0 — a guard bug must never wedge a
// legitimate screenshot.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SCREENSHOT_TOOL =
  "mcp__plugin_playwright_playwright__browser_take_screenshot";

/**
 * Matches the screenshot tool under ANY MCP server id — the plugin's own
 * (`mcp__plugin_playwright_playwright__…`) and a bare re-install
 * (`mcp__playwright__…`). Pinning the literal name alone would silently
 * disarm the guard the day the server is re-registered.
 */
export function isScreenshotTool(name) {
  return (
    typeof name === "string" && /^mcp__.*__browser_take_screenshot$/.test(name)
  );
}

/** Drive-letter (`C:\…` / `C:/…`), UNC (`\\host\share`), or POSIX (`/…`). */
export function isAbsolutePath(p) {
  if (typeof p !== "string" || p === "") return false;
  return /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\/.test(p) || p.startsWith("/");
}

export function blockMessage(filename) {
  return (
    `BLOCKED: browser_take_screenshot filename '${filename}' is RELATIVE.\n` +
    `Playwright MCP resolves it against the server's cwd — the repository root — so ` +
    `the PNG lands in the SHARED main tree as untracked clutter (#1169: 18 stray files ` +
    `at root, from 73 such calls).\n` +
    `Pass an ABSOLUTE filename under a stable dir instead — ` +
    `'%LOCALAPPDATA%\\Temp\\.playwright-mcp\\<name>.png' is always an allowed root ` +
    `(memory reference_ds_platform_dev_stand_recipe → Playwright MCP screenshots).\n` +
    `For a deliverable, copy the file out to 'Pictures\\<task>\\' afterwards with the ` +
    `Bash tool — never leave the only copy in the repo tree.\n`
  );
}

/**
 * Pure decision seam: should this tool call be blocked? True only for the
 * screenshot tool carrying a `filename` string that is not an absolute path.
 * Everything else — another tool, a missing/omitted filename, a non-string
 * filename, a malformed `tool_input` — returns `{ block: false }`.
 */
export function decideScreenshotBlock({ toolName, toolInput }) {
  if (!isScreenshotTool(toolName)) return { block: false };
  if (!toolInput || typeof toolInput !== "object") return { block: false };

  const { filename } = toolInput;
  if (typeof filename !== "string" || filename === "") return { block: false };
  if (isAbsolutePath(filename)) return { block: false };

  return { block: true, filename };
}

function main() {
  try {
    const payload = JSON.parse(readFileSync(0, "utf8"));
    const decision = decideScreenshotBlock({
      toolName: payload.tool_name || "",
      toolInput: payload.tool_input,
    });
    if (decision.block) {
      process.stderr.write(blockMessage(decision.filename));
      process.exit(2);
    }
    process.exit(0);
  } catch {
    process.exit(0); // fail-open: never wedge a legitimate screenshot
  }
}

// Entry-point guard: run `main()` only when invoked directly, so the guard-tests
// spec can import the pure seams without firing stdin reads / process.exit.
const invoked = process.argv[1]
  ? resolve(process.argv[1]).replace(/\\/g, "/")
  : "";
if (
  invoked &&
  invoked === resolve(fileURLToPath(import.meta.url)).replace(/\\/g, "/")
) {
  main();
}

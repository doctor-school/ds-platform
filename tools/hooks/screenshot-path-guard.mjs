#!/usr/bin/env node
// PreToolUse guard on the Playwright-MCP file-writing tools (#1169).
//
// The MCP server resolves a caller-supplied `filename` against its own cwd —
// which is the REPOSITORY ROOT — and only then checks access:
//
//   resolvedName = path.resolve(workspace, fileName);   // workspace = cwd
//   await checkFile(options, resolvedName, { origin: "llm" });
//
//   function outputDir(options) {                       // playwright-core 0.0.78,
//     if (options.config.outputDir) …                   // packages/playwright-core/
//     if (isSystemDirectory(cwd) || !isWritable(cwd))   //   src/tools/backend/context.ts
//       return path.join(os.tmpdir(), ".playwright-mcp");
//     return path.join(options.cwd, ".playwright-mcp");
//   }
//
//   function checkFile(options, resolved, flags) {
//     …
//     if (!isPathInside(outputDir(options), resolved) && !isPathInside(cwd, resolved))
//       throw new Error(`File access denied: … Allowed roots: …`);
//   }
//
// Two consequences drive this guard:
//
// 1. A RELATIVE `filename` always lands somewhere under the repo tree. A bare
//    name lands in the ROOT: 18 stray PNGs (5.8 MB) accumulated there between
//    June and July 2026, from 73 bare-filename calls across the session
//    transcripts. That is what this guard blocks.
// 2. The only paths the server will accept are the repo tree itself and
//    `<repo>/.playwright-mcp` (unless the server is launched with an explicit
//    `--output-dir` / `allowUnrestrictedFileAccess`). So the guard CANNOT steer
//    callers to a scratch dir outside the repo — that raises `File access
//    denied`. It steers them into `.playwright-mcp/` instead, which is
//    `.gitignore`d and is where the server's own auto-named files already go.
//
// The rule this enforces lived in auto-memory only
// (`reference_ds_platform_dev_stand_recipe` → "Playwright MCP screenshots") and
// structurally could not reach the call site: auto-memory is load-on-demand, and
// dispatched subagents — where browser payloads run per `.claude/rules/dev-stand.md`
// — do not inherit the lead's memory at all. Hence enforcement at the tool call.
//
// Contract: reads the PreToolUse hook JSON on stdin ({session_id, cwd,
// tool_name, tool_input:{filename}}). Exit 2 + stderr = BLOCK. Exit 0 = allow.
// FAIL-OPEN: any parse/logic error exits 0 — a guard bug must never wedge a
// legitimate screenshot.

import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SCREENSHOT_TOOL =
  "mcp__plugin_playwright_playwright__browser_take_screenshot";

/** The server's own output dir, relative to its cwd (playwright-core 0.0.78). */
export const SERVER_OUTPUT_DIR = ".playwright-mcp";

/**
 * Matches the file-writing browser tools under ANY MCP server id — the plugin's
 * own (`mcp__plugin_playwright_playwright__…`) and a bare re-install
 * (`mcp__playwright__…`). Pinning one literal name would silently disarm the
 * guard the day the server is re-registered. `browser_pdf_save` takes the same
 * `filename` through the same resolve+check path, so it is in scope too.
 */
export function isScreenshotTool(name) {
  return (
    typeof name === "string" &&
    /^mcp__.*__browser_(take_screenshot|pdf_save)$/.test(name)
  );
}

/**
 * Case-folded, forward-slashed, trailing-slash-free form for path comparison.
 * Case folding matters: the guard runs on Windows, where `C:\Users\…` and
 * `c:\users\…` are the same directory (same convention as the sibling hooks).
 */
export function normPath(p) {
  if (typeof p !== "string" || p === "") return "";
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** Is `child` the same path as `parent`, or nested under it? */
export function isPathInside(parent, child) {
  const p = normPath(parent);
  const c = normPath(child);
  if (!p || !c) return false;
  return c === p || c.startsWith(p + "/");
}

export function blockMessage({ filename, resolved, cwd }) {
  return (
    `BLOCKED: browser_take_screenshot filename '${filename}' writes INSIDE the repository tree.\n` +
    `Resolved target: ${resolved}\n` +
    `Playwright MCP resolves a relative filename against its cwd — the repo root — so the ` +
    `file lands in the SHARED working tree as untracked clutter (#1169: 18 stray files, ` +
    `5.8 MB, from 73 such calls).\n` +
    `Write under '${SERVER_OUTPUT_DIR}/' instead — e.g. filename ` +
    `'${SERVER_OUTPUT_DIR}/<task>/<name>.png'. That directory is .gitignore'd and is where ` +
    `the server's own auto-named files already go.\n` +
    `Do NOT retarget outside the repo: the server's allowed roots are exactly ` +
    `'${cwd}' and '${cwd}/${SERVER_OUTPUT_DIR}' (playwright-core checkFile) — anything else ` +
    `raises 'File access denied'.\n` +
    `For a deliverable, copy the file out to 'Pictures\\<task>\\' afterwards with the Bash ` +
    `tool — never leave the only copy in the repo tree.\n`
  );
}

/**
 * Pure decision seam. BLOCK only when the call would write into the repo tree
 * OUTSIDE the git-ignored `.playwright-mcp/` dir. Explicitly allowed:
 *
 * - another tool, a malformed `tool_input`, a non-string / empty `filename`;
 * - an OMITTED `filename` — the server names the file itself and puts it in its
 *   own `.playwright-mcp/` output dir (git-ignored);
 * - any path under `<cwd>/.playwright-mcp/`, relative or absolute;
 * - a path outside the repo tree — the server's own `checkFile` adjudicates
 *   that, and a guard that pre-empted it would wedge a legitimate configuration
 *   (`--output-dir` / `allowUnrestrictedFileAccess`).
 *
 * Without a usable `cwd` in the payload the resolve cannot be reproduced, so the
 * guard falls back to the shape rule: a relative path that is not already under
 * `.playwright-mcp/` is blocked.
 */
export function decideScreenshotBlock({ toolName, toolInput, cwd }) {
  if (!isScreenshotTool(toolName)) return { block: false };
  if (!toolInput || typeof toolInput !== "object") return { block: false };

  const { filename } = toolInput;
  if (typeof filename !== "string" || filename === "") return { block: false };

  if (typeof cwd !== "string" || cwd === "") {
    // No cwd → cannot resolve. Shape fallback: absolute paths and paths already
    // inside `.playwright-mcp/` pass; every other relative path is the #1169 class.
    if (isAbsolute(filename)) return { block: false };
    const rel = normPath(filename);
    if (rel === SERVER_OUTPUT_DIR || rel.startsWith(`${SERVER_OUTPUT_DIR}/`)) {
      return { block: false };
    }
    return { block: true, filename, resolved: filename, cwd: "" };
  }

  const resolved = resolve(cwd, filename);
  const outputDir = resolve(cwd, SERVER_OUTPUT_DIR);

  if (isPathInside(outputDir, resolved)) return { block: false };
  if (isPathInside(cwd, resolved))
    return { block: true, filename, resolved, cwd };
  return { block: false };
}

function main() {
  try {
    const payload = JSON.parse(readFileSync(0, "utf8"));
    const decision = decideScreenshotBlock({
      toolName: payload.tool_name || "",
      toolInput: payload.tool_input,
      cwd: payload.cwd || "",
    });
    if (decision.block) {
      process.stderr.write(blockMessage(decision));
      process.exit(2);
    }
    process.exit(0);
  } catch {
    process.exit(0); // fail-open: never wedge a legitimate screenshot
  }
}

// Entry-point guard: run `main()` only when invoked directly, so the guard-tests
// spec can import the pure seams without firing stdin reads / process.exit.
const invoked = process.argv[1] ? normPath(resolve(process.argv[1])) : "";
if (invoked && invoked === normPath(resolve(fileURLToPath(import.meta.url)))) {
  main();
}

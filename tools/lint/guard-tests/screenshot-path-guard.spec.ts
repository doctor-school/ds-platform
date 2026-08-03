import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The hook is plain ESM JS (runs under bare `node` from settings.json), so the
// spec imports its pure seams directly — same pattern as the sibling hook specs
// (askuserquestion-calibration-guard.spec.ts, completion-report-gate.spec.ts).
import {
  SCREENSHOT_TOOL,
  blockMessage,
  decideScreenshotBlock,
  isAbsolutePath,
  isScreenshotTool,
} from "../../hooks/screenshot-path-guard.mjs";

/**
 * Cover for the #1169 screenshot-path guard (PreToolUse hook): a
 * `browser_take_screenshot` whose `filename` is RELATIVE resolves against the
 * MCP server's cwd — the repository root — and drops a stray PNG into the
 * shared main tree (73 such calls across the project's transcripts; 18 files,
 * 5.8 MB found at root on 2026-08-03). The guard BLOCKS those calls (exit 2)
 * and names the sanctioned absolute target; an absolute `filename` and an
 * OMITTED `filename` (the server then writes into its own output dir, not the
 * repo root) pass through. Fail-open on anything malformed — a guard bug must
 * never wedge a legitimate screenshot.
 */

const HOOK = fileURLToPath(
  new URL("../../hooks/screenshot-path-guard.mjs", import.meta.url),
);

function runHook(payload: unknown) {
  return spawnSync(process.execPath, [HOOK], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
  });
}

const payloadWith = (
  toolInput: unknown,
  toolName: string = SCREENSHOT_TOOL,
) => ({
  session_id: "s-1169",
  cwd: "C:/Users/dev/repos/ds-platform",
  hook_event_name: "PreToolUse",
  tool_name: toolName,
  tool_input: toolInput,
});

describe("isAbsolutePath", () => {
  it("accepts a Windows drive-letter path in either slash flavour", () => {
    expect(isAbsolutePath("C:\\Users\\dev\\shot.png")).toBe(true);
    expect(isAbsolutePath("C:/Users/dev/shot.png")).toBe(true);
  });

  it("accepts a UNC path and a POSIX path", () => {
    expect(isAbsolutePath("\\\\nas\\share\\shot.png")).toBe(true);
    expect(isAbsolutePath("/tmp/shot.png")).toBe(true);
  });

  it("rejects every relative shape", () => {
    expect(isAbsolutePath("room-vk-playing.png")).toBe(false);
    expect(isAbsolutePath("./room-vk-playing.png")).toBe(false);
    expect(isAbsolutePath("../room-vk-playing.png")).toBe(false);
    expect(isAbsolutePath(".playwright-mcp/eyes-on/shot.png")).toBe(false);
  });
});

describe("isScreenshotTool", () => {
  it("matches the screenshot tool under any MCP server id", () => {
    expect(isScreenshotTool(SCREENSHOT_TOOL)).toBe(true);
    // A bare re-install of the same server must not disarm the guard.
    expect(isScreenshotTool("mcp__playwright__browser_take_screenshot")).toBe(
      true,
    );
  });

  it("does not match sibling tools or non-MCP tools", () => {
    expect(isScreenshotTool("mcp__playwright__browser_click")).toBe(false);
    expect(isScreenshotTool("browser_take_screenshot")).toBe(false);
    expect(isScreenshotTool(undefined)).toBe(false);
  });
});

describe("decideScreenshotBlock", () => {
  it("blocks a relative filename under a re-installed server id", () => {
    expect(
      decideScreenshotBlock({
        toolName: "mcp__playwright__browser_take_screenshot",
        toolInput: { filename: "stray.png" },
      }).block,
    ).toBe(true);
  });

  it("blocks the bare filename that caused #1169", () => {
    // Verbatim from the 2026-07-24 subagent transcript (session 5e786bf7).
    const decision = decideScreenshotBlock({
      toolName: SCREENSHOT_TOOL,
      toolInput: { filename: "room-vk-playing.png", type: "png", scale: "css" },
    });
    expect(decision.block).toBe(true);
    expect(decision.filename).toBe("room-vk-playing.png");
  });

  it("blocks a relative path with a subdirectory", () => {
    expect(
      decideScreenshotBlock({
        toolName: SCREENSHOT_TOOL,
        toolInput: { filename: ".playwright-mcp/eyes-on/1132-chat.png" },
      }).block,
    ).toBe(true);
  });

  it("allows an absolute filename", () => {
    for (const filename of [
      "C:\\Users\\dev\\AppData\\Local\\Temp\\.playwright-mcp\\shot.png",
      "C:/Users/dev/Pictures/1169/shot.png",
      "/tmp/.playwright-mcp/shot.png",
      "\\\\nas\\share\\shot.png",
    ]) {
      expect(
        decideScreenshotBlock({
          toolName: SCREENSHOT_TOOL,
          toolInput: { filename },
        }).block,
      ).toBe(false);
    }
  });

  it("allows an omitted filename — the server writes to its own output dir", () => {
    expect(
      decideScreenshotBlock({
        toolName: SCREENSHOT_TOOL,
        toolInput: { type: "png" },
      }).block,
    ).toBe(false);
    expect(
      decideScreenshotBlock({ toolName: SCREENSHOT_TOOL, toolInput: {} }).block,
    ).toBe(false);
  });

  it("ignores every other tool, including sibling playwright calls", () => {
    expect(
      decideScreenshotBlock({
        toolName: "mcp__plugin_playwright_playwright__browser_navigate",
        toolInput: { filename: "room-vk-playing.png" },
      }).block,
    ).toBe(false);
    expect(
      decideScreenshotBlock({
        toolName: "Write",
        toolInput: { filename: "notes.png" },
      }).block,
    ).toBe(false);
  });

  it("fails open on a malformed tool_input", () => {
    expect(
      decideScreenshotBlock({ toolName: SCREENSHOT_TOOL, toolInput: null })
        .block,
    ).toBe(false);
    expect(
      decideScreenshotBlock({
        toolName: SCREENSHOT_TOOL,
        toolInput: { filename: 42 },
      }).block,
    ).toBe(false);
  });
});

describe("blockMessage", () => {
  it("names the offending filename and the sanctioned absolute target", () => {
    const msg = blockMessage("room-vk-playing.png");
    expect(msg).toContain("room-vk-playing.png");
    expect(msg).toContain("LOCALAPPDATA");
    expect(msg).toContain("Pictures");
  });
});

describe("hook process contract", () => {
  it("exits 2 with an actionable stderr on a relative filename", () => {
    const res = runHook(payloadWith({ filename: "room-vk-playing.png" }));
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("room-vk-playing.png");
    expect(res.stderr).toContain("LOCALAPPDATA");
  });

  it("exits 0 on an absolute filename", () => {
    const res = runHook(
      payloadWith({ filename: "C:\\Users\\dev\\AppData\\Local\\Temp\\a.png" }),
    );
    expect(res.status).toBe(0);
  });

  it("exits 0 for an unrelated tool", () => {
    const res = runHook(
      payloadWith(
        { filename: "a.png" },
        "mcp__plugin_playwright_playwright__browser_click",
      ),
    );
    expect(res.status).toBe(0);
  });

  it("fails open on unparseable stdin", () => {
    const res = runHook("not json at all");
    expect(res.status).toBe(0);
  });
});

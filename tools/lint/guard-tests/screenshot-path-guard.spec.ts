import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The hook is plain ESM JS (runs under bare `node` from settings.json), so the
// spec imports its pure seams directly — same pattern as the sibling hook specs
// (askuserquestion-calibration-guard.spec.ts, dispatch-guard.spec.ts).
import {
  SCREENSHOT_TOOL,
  SERVER_OUTPUT_DIR,
  blockMessage,
  decideScreenshotBlock,
  guardedRoots,
  isPathInside,
  isScreenshotTool,
  normPath,
} from "../../hooks/screenshot-path-guard.mjs";

/**
 * Cover for the #1169 screenshot-path guard (PreToolUse hook).
 *
 * Playwright MCP resolves a caller-supplied `filename` against its own cwd (the
 * repo root) and then accepts it only if it lands in the repo tree or in
 * `<cwd>/.playwright-mcp` (playwright-core 0.0.78 `checkFile`/`outputDir`). So
 * the guard blocks exactly one class — a write INSIDE the repo tree but OUTSIDE
 * the git-ignored `.playwright-mcp/` — and must NOT steer callers out of the
 * tree, which the server refuses with `File access denied`.
 *
 * Paths are built with `os.tmpdir()` + `path.resolve` so the spec behaves
 * identically on Windows and the Linux CI runner (a hardcoded `C:\…` literal is
 * a RELATIVE segment to POSIX `path.resolve` — the trap that broke the `unit`
 * job for the read-guard spec).
 */

const HOOK = fileURLToPath(
  new URL("../../hooks/screenshot-path-guard.mjs", import.meta.url),
);

const CWD = resolve(tmpdir(), "fake-ds-root");
const OUTPUT_DIR = resolve(CWD, SERVER_OUTPUT_DIR);
const OUTSIDE = resolve(tmpdir(), "fake-elsewhere");
const PDF_TOOL = "mcp__playwright__browser_pdf_save";

function runHook(payload: unknown) {
  return spawnSync(process.execPath, [HOOK], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
  });
}

const payloadWith = (
  toolInput: unknown,
  toolName: string = SCREENSHOT_TOOL,
  cwd: string = CWD,
) => ({
  session_id: "s-1169",
  cwd,
  hook_event_name: "PreToolUse",
  tool_name: toolName,
  tool_input: toolInput,
});

const decide = (filename: unknown, cwd: string = CWD) =>
  decideScreenshotBlock({
    toolName: SCREENSHOT_TOOL,
    toolInput: { filename },
    cwd,
  });

describe("isScreenshotTool", () => {
  it("matches the file-writing browser tools under any MCP server id", () => {
    expect(isScreenshotTool(SCREENSHOT_TOOL)).toBe(true);
    // A bare re-install of the same server must not disarm the guard.
    expect(isScreenshotTool("mcp__playwright__browser_take_screenshot")).toBe(
      true,
    );
    // `browser_pdf_save` writes through the same resolve+check path.
    expect(isScreenshotTool("mcp__playwright__browser_pdf_save")).toBe(true);
  });

  it("does not match sibling tools or non-MCP tools", () => {
    expect(isScreenshotTool("mcp__playwright__browser_click")).toBe(false);
    expect(isScreenshotTool("browser_take_screenshot")).toBe(false);
    expect(isScreenshotTool(undefined)).toBe(false);
  });
});

describe("normPath / isPathInside", () => {
  it("folds case and slash flavour — the guard runs on Windows", () => {
    expect(normPath("C:\\Users\\Dev\\Repo\\")).toBe("c:/users/dev/repo");
    expect(
      isPathInside("C:\\Users\\Dev\\repo", "c:/USERS/dev/Repo/a.png"),
    ).toBe(true);
  });

  it("does not treat a sibling with a shared prefix as nested", () => {
    expect(isPathInside("/a/repo", "/a/repo-2/x.png")).toBe(false);
    expect(isPathInside("/a/repo", "/a/repo")).toBe(true);
  });

  it("returns false for empty operands", () => {
    expect(isPathInside("", "/a/x.png")).toBe(false);
    expect(isPathInside("/a", "")).toBe(false);
  });
});

describe("decideScreenshotBlock — the #1169 class", () => {
  it("blocks the bare filename that caused #1169", () => {
    // Verbatim from the 2026-07-24 subagent transcript (session 5e786bf7).
    const decision = decideScreenshotBlock({
      toolName: SCREENSHOT_TOOL,
      toolInput: { filename: "room-vk-playing.png", type: "png", scale: "css" },
      cwd: CWD,
    });
    expect(decision.block).toBe(true);
    expect(decision.filename).toBe("room-vk-playing.png");
    expect(normPath(decision.resolved)).toBe(
      normPath(resolve(CWD, "room-vk-playing.png")),
    );
  });

  it("blocks a relative path into any other in-tree directory", () => {
    expect(decide("./shot.png").block).toBe(true);
    expect(decide("apps/portal/shot.png").block).toBe(true);
    expect(decide("shots/1169/shot.png").block).toBe(true);
  });

  it("blocks an ABSOLUTE path that still points inside the tree", () => {
    // The shape rule alone ("absolute is fine") missed this class.
    expect(decide(resolve(CWD, "shot.png")).block).toBe(true);
    expect(decide(resolve(CWD, "apps", "portal", "shot.png")).block).toBe(true);
  });

  it("blocks a traversal that climbs back into the tree", () => {
    expect(decide(`${SERVER_OUTPUT_DIR}/../shot.png`).block).toBe(true);
  });
});

describe("guardedRoots — the worktree escape", () => {
  const WT = resolve(CWD, ".claude", "worktrees", "1169");

  it("adds the shared main tree when the cwd is a worktree", () => {
    expect(guardedRoots(WT).map(normPath)).toEqual([
      normPath(WT),
      normPath(CWD),
    ]);
  });

  it("is just the cwd for a non-worktree tree", () => {
    expect(guardedRoots(CWD).map(normPath)).toEqual([normPath(CWD)]);
  });

  it("blocks a traversal out of the worktree into the main tree", () => {
    // Resolves outside the worktree, so the single-root check let it through —
    // straight into the shared tree the owner works in.
    expect(decide("../../../shot.png", WT).block).toBe(true);
    expect(decide(resolve(CWD, "shot.png"), WT).block).toBe(true);
  });

  it("still allows either tree's .playwright-mcp/ from inside the worktree", () => {
    expect(decide(`${SERVER_OUTPUT_DIR}/shot.png`, WT).block).toBe(false);
    expect(decide(resolve(OUTPUT_DIR, "shot.png"), WT).block).toBe(false);
  });

  it("allows the worktree-root output dir when cwd is a worktree subdirectory", () => {
    const worktreeSubdirectory = resolve(WT, "apps", "portal");
    expect(guardedRoots(worktreeSubdirectory).map(normPath)).toEqual([
      normPath(worktreeSubdirectory),
      normPath(WT),
      normPath(CWD),
    ]);
    expect(
      decide(
        resolve(WT, SERVER_OUTPUT_DIR, "1174-worktree-root.png"),
        worktreeSubdirectory,
      ).block,
    ).toBe(false);
  });
});

describe("decideScreenshotBlock — what must keep working", () => {
  it("allows the server's own output dir, relative or absolute", () => {
    expect(decide(`${SERVER_OUTPUT_DIR}/shot.png`).block).toBe(false);
    expect(decide(`${SERVER_OUTPUT_DIR}/eyes-on/1132-chat.png`).block).toBe(
      false,
    );
    expect(decide(resolve(OUTPUT_DIR, "eyes-on", "shot.png")).block).toBe(
      false,
    );
  });

  it("allows a path outside the tree — the server's own checkFile adjudicates", () => {
    // Pre-empting it would wedge a server launched with --output-dir.
    expect(decide(resolve(OUTSIDE, "shot.png")).block).toBe(false);
  });

  it("allows an omitted filename — the server names it into .playwright-mcp/", () => {
    expect(
      decideScreenshotBlock({
        toolName: SCREENSHOT_TOOL,
        toolInput: { type: "png" },
        cwd: CWD,
      }).block,
    ).toBe(false);
    expect(
      decideScreenshotBlock({
        toolName: SCREENSHOT_TOOL,
        toolInput: {},
        cwd: CWD,
      }).block,
    ).toBe(false);
  });

  it("ignores every other tool, including sibling playwright calls", () => {
    expect(
      decideScreenshotBlock({
        toolName: "mcp__plugin_playwright_playwright__browser_navigate",
        toolInput: { filename: "room-vk-playing.png" },
        cwd: CWD,
      }).block,
    ).toBe(false);
    expect(
      decideScreenshotBlock({
        toolName: "Write",
        toolInput: { filename: "notes.png" },
        cwd: CWD,
      }).block,
    ).toBe(false);
  });

  it("fails open on a malformed tool_input", () => {
    expect(
      decideScreenshotBlock({
        toolName: SCREENSHOT_TOOL,
        toolInput: null,
        cwd: CWD,
      }).block,
    ).toBe(false);
    expect(decide(42).block).toBe(false);
    expect(decide("").block).toBe(false);
  });
});

describe("decideScreenshotBlock — no-cwd fallback", () => {
  it("blocks a bare relative name when the resolve cannot be reproduced", () => {
    expect(decide("room-vk-playing.png", "").block).toBe(true);
  });

  it("allows an absolute path or an in-output-dir path without cwd", () => {
    expect(decide("/tmp/shot.png", "").block).toBe(false);
    expect(decide(`${SERVER_OUTPUT_DIR}/shot.png`, "").block).toBe(false);
  });
});

describe("decideScreenshotBlock — PDF writes", () => {
  it("blocks browser_pdf_save and carries the actual tool into the refusal", () => {
    const decision = decideScreenshotBlock({
      toolName: PDF_TOOL,
      toolInput: { filename: "room-export.pdf" },
      cwd: CWD,
    });
    expect(decision.block).toBe(true);
    expect(decision.toolName).toBe(PDF_TOOL);
  });
});

describe("blockMessage", () => {
  it("names the file, the resolved target, and the only writable in-tree dir", () => {
    const msg = blockMessage({
      filename: "room-vk-playing.png",
      resolved: resolve(CWD, "room-vk-playing.png"),
      cwd: CWD,
    });
    expect(msg).toContain("room-vk-playing.png");
    expect(msg).toContain(SERVER_OUTPUT_DIR);
    expect(msg).toContain("Pictures");
    // It must NOT steer outside the tree — that is `File access denied`.
    expect(msg).toContain("File access denied");
    expect(msg).not.toContain("LOCALAPPDATA");
    // Nor into a nested dir: a caller-supplied filename is never mkdir'd, so
    // `.playwright-mcp/<dir>/x.png` fails with ENOENT unless <dir> exists.
    expect(msg).toContain("ENOENT");
    expect(msg).toContain(`${SERVER_OUTPUT_DIR}/<task>-<name>.png`);
    expect(msg).not.toContain(`${SERVER_OUTPUT_DIR}/<task>/<name>.png`);
  });
});

describe("hook process contract", () => {
  it("exits 2 with an actionable stderr on a bare relative filename", () => {
    const res = runHook(payloadWith({ filename: "room-vk-playing.png" }));
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("room-vk-playing.png");
    expect(res.stderr).toContain(SERVER_OUTPUT_DIR);
  });

  it("exits 2 on an absolute in-tree filename", () => {
    const res = runHook(payloadWith({ filename: resolve(CWD, "shot.png") }));
    expect(res.status).toBe(2);
  });

  it("exits 2 and names browser_pdf_save for a PDF filename", () => {
    const res = runHook(payloadWith({ filename: "room-export.pdf" }, PDF_TOOL));
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("browser_pdf_save");
    expect(res.stderr).not.toContain("browser_take_screenshot");
    expect(res.stderr).toContain(`${SERVER_OUTPUT_DIR}/<task>-<name>.pdf`);
  });

  it("does not render empty allowed roots when cwd is omitted", () => {
    const res = runHook(
      payloadWith({ filename: "room-vk-playing.png" }, SCREENSHOT_TOOL, ""),
    );
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("hook payload did not include cwd");
    expect(res.stderr).not.toContain("'' and '/.playwright-mcp'");
  });

  it("exits 0 — silently — for the paths that must keep working", () => {
    for (const filename of [
      `${SERVER_OUTPUT_DIR}/eyes-on/shot.png`,
      resolve(OUTPUT_DIR, "shot.png"),
      resolve(OUTSIDE, "shot.png"),
    ]) {
      const res = runHook(payloadWith({ filename }));
      expect(res.status).toBe(0);
      expect(res.stderr).toBe("");
    }
  });

  it("exits 0 for an unrelated tool", () => {
    const res = runHook(
      payloadWith(
        { filename: "a.png" },
        "mcp__plugin_playwright_playwright__browser_click",
      ),
    );
    expect(res.status).toBe(0);
    expect(res.stderr).toBe("");
  });

  it("fails open on unparseable stdin", () => {
    const res = runHook("not json at all");
    expect(res.status).toBe(0);
  });
});

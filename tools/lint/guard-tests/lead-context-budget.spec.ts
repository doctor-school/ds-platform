import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// The hook is plain ESM JS (runs under bare `node` from settings.json), so the
// spec imports its pure seams directly — same pattern as
// subagent-context-budget.spec.ts.
import {
  HARD_THRESHOLD,
  OVERRIDE_REL,
  SOFT_THRESHOLD,
  decide,
  hardMessage,
  overrideActive,
  overrideMessage,
  overridePath,
  softMessage,
} from "../../hooks/lead-context-budget.mjs";

/**
 * Unit + end-to-end cover for the #1693 LEAD context budget hook: a PreToolUse
 * guard on `Agent|Task` that acts ONLY for the lead (stdin carries NO
 * `agent_id`), measures the lead's own `transcript_path`, warns at
 * SOFT_THRESHOLD, DENIES a new dispatch at HARD_THRESHOLD, and is lifted —
 * loudly — by the `.claude/lead-budget-override` marker. Fail-open on anything
 * malformed.
 */

const HOOK = resolve(__dirname, "../../hooks/lead-context-budget.mjs");

/** Run the real hook as a subprocess with a JSON payload on stdin. */
function runHook(
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv = {},
) {
  const stdout = execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return stdout.trim();
}

/** One transcript line whose assistant usage block sums to `contextTokens`. */
function usageLine(contextTokens: number): string {
  return `${JSON.stringify({
    type: "assistant",
    message: {
      usage: {
        input_tokens: 0,
        cache_read_input_tokens: contextTokens,
        cache_creation_input_tokens: 0,
      },
    },
  })}\n`;
}

const tempDirs: string[] = [];

/** A lead transcript `<tmp>/<session>.jsonl` reporting `contextTokens`. */
function leadTranscript(contextTokens: number): string {
  const dir = mkdtempSync(join(tmpdir(), "lead-ctx-"));
  tempDirs.push(dir);
  const path = join(dir, "sess-1.jsonl");
  writeFileSync(path, usageLine(contextTokens));
  return path;
}

/** A throwaway project root, optionally carrying the override marker. */
function projectDir(withOverride: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "lead-ctx-root-"));
  tempDirs.push(dir);
  if (withOverride) {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(overridePath(dir), "owner override\n");
  }
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe("lead-context-budget thresholds", () => {
  it("owner-decided constants (2026-08-31, #1693): 120K soft / 160K hard", () => {
    expect(SOFT_THRESHOLD).toBe(120_000);
    expect(HARD_THRESHOLD).toBe(160_000);
  });

  it("the override marker is the documented repo-relative path", () => {
    expect(OVERRIDE_REL).toBe(".claude/lead-budget-override");
    // `resolve()` prefixes a drive letter on Windows — assert the suffix, so
    // the expectation holds on the Linux CI runner and locally alike.
    expect(overridePath("/repo").replace(/\\/g, "/")).toMatch(
      /\/repo\/\.claude\/lead-budget-override$/,
    );
  });
});

describe("lead-context-budget decide()", () => {
  it("below the soft cap → silent (override or not)", () => {
    expect(decide({ contextTokens: 119_999, override: false }).action).toBe(
      "silent",
    );
    expect(decide({ contextTokens: 0, override: true }).action).toBe("silent");
  });

  it("soft band 120K–159K → soft warning", () => {
    for (const ctx of [120_000, 140_000, 159_999]) {
      expect(decide({ contextTokens: ctx, override: false }).action).toBe(
        "soft",
      );
    }
  });

  it("≥160K → deny", () => {
    for (const ctx of [160_000, 208_000, 325_000]) {
      expect(decide({ contextTokens: ctx, override: false }).action).toBe(
        "deny",
      );
    }
  });

  it("the override marker lifts BOTH tiers, loudly", () => {
    expect(decide({ contextTokens: 130_000, override: true }).action).toBe(
      "override",
    );
    expect(decide({ contextTokens: 325_000, override: true }).action).toBe(
      "override",
    );
  });

  it("a non-numeric context reads as 0 (fail-open)", () => {
    expect(
      decide({ contextTokens: Number.NaN, override: false }).action,
    ).toBe("silent");
  });
});

describe("lead-context-budget overrideActive()", () => {
  it("true only when the marker file exists", () => {
    expect(overrideActive(projectDir(true))).toBe(true);
    expect(overrideActive(projectDir(false))).toBe(false);
  });

  it("an existsSync that throws reads as inactive (fail-closed on the hatch)", () => {
    expect(
      overrideActive("/repo", () => {
        throw new Error("io");
      }),
    ).toBe(false);
  });
});

describe("lead-context-budget messages", () => {
  it("the soft warning names the measured size and the wave contract", () => {
    const msg = softMessage(140_000);
    expect(msg).toContain("140K");
    expect(msg).toContain("120K");
    expect(msg).toContain("/wrap");
  });

  it("the deny message names the size, the cap and the override hatch", () => {
    const msg = hardMessage(208_000);
    expect(msg).toContain("208K");
    expect(msg).toContain("160K");
    expect(msg).toContain(OVERRIDE_REL);
  });

  it("the override message announces the override rather than hiding it", () => {
    const msg = overrideMessage(325_000);
    expect(msg).toContain("325K");
    expect(msg).toContain("OVERRIDE");
    expect(msg).toContain(OVERRIDE_REL);
  });
});

describe("lead-context-budget end-to-end (real hook process)", () => {
  it("silent below the soft cap", () => {
    expect(
      runHook(
        {
          session_id: "sess-1",
          tool_name: "Agent",
          tool_input: {},
          transcript_path: leadTranscript(90_000),
        },
        { CLAUDE_PROJECT_DIR: projectDir(false) },
      ),
    ).toBe("");
  });

  it("soft band → additionalContext warning WITHOUT a permissionDecision", () => {
    const json = JSON.parse(
      runHook(
        {
          session_id: "sess-1",
          tool_name: "Agent",
          tool_input: {},
          transcript_path: leadTranscript(140_000),
        },
        { CLAUDE_PROJECT_DIR: projectDir(false) },
      ),
    );
    expect(json.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(json.hookSpecificOutput.additionalContext).toContain("140K");
    expect(json.hookSpecificOutput.permissionDecision).toBeUndefined();
  });

  it("≥160K → deny with the wrap/handoff reason", () => {
    const json = JSON.parse(
      runHook(
        {
          session_id: "sess-1",
          tool_name: "Task",
          tool_input: {},
          transcript_path: leadTranscript(208_000),
        },
        { CLAUDE_PROJECT_DIR: projectDir(false) },
      ),
    );
    expect(json.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(json.hookSpecificOutput.permissionDecisionReason).toContain(
      "/wrap",
    );
    expect(json.systemMessage).toContain("208K");
  });

  it("the override marker turns the deny into a loud allow", () => {
    const json = JSON.parse(
      runHook(
        {
          session_id: "sess-1",
          tool_name: "Agent",
          tool_input: {},
          transcript_path: leadTranscript(208_000),
        },
        { CLAUDE_PROJECT_DIR: projectDir(true) },
      ),
    );
    expect(json.hookSpecificOutput.permissionDecision).toBeUndefined();
    expect(json.hookSpecificOutput.additionalContext).toContain("OVERRIDE");
  });

  it("a SUBAGENT dispatch (agent_id present) is silent even at 325K", () => {
    expect(
      runHook(
        {
          session_id: "sess-1",
          agent_id: "a1",
          tool_name: "Agent",
          tool_input: {},
          transcript_path: leadTranscript(325_000),
        },
        { CLAUDE_PROJECT_DIR: projectDir(false) },
      ),
    ).toBe("");
  });

  it("fail-open: malformed stdin, no transcript path, missing transcript", () => {
    const bad = execFileSync(process.execPath, [HOOK], {
      input: "{not json",
      encoding: "utf8",
    });
    expect(bad.trim()).toBe("");
    expect(
      runHook(
        { session_id: "sess-1", tool_name: "Agent", tool_input: {} },
        { CLAUDE_PROJECT_DIR: projectDir(false) },
      ),
    ).toBe("");
    expect(
      runHook(
        {
          session_id: "sess-1",
          tool_name: "Agent",
          tool_input: {},
          transcript_path: "/definitely/not/here.jsonl",
        },
        { CLAUDE_PROJECT_DIR: projectDir(false) },
      ),
    ).toBe("");
  });
});

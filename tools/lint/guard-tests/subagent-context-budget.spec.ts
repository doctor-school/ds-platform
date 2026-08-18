import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The hook is plain ESM JS (runs under bare `node` from settings.json), so the
// spec imports its pure seams directly — same pattern as dispatch-guard.spec.ts.
import {
  HARD_THRESHOLD,
  SOFT_REPEAT_STEP,
  SOFT_THRESHOLD,
  checkpointPath,
  decide,
  hardMessage,
  isAllowedUnderHardCap,
  readState,
  softMessage,
  stateFilePath,
} from "../../hooks/subagent-context-budget.mjs";

/**
 * Unit + end-to-end cover for the #1374 subagent context budget hook: a
 * PreToolUse guard that acts ONLY inside a subagent (stdin `agent_id`), reads
 * the subagent's own transcript, injects a ROTATE directive at SOFT_THRESHOLD
 * (then every +SOFT_REPEAT_STEP) and DENIES every non-allow-listed tool at
 * HARD_THRESHOLD. Fail-open on anything malformed.
 */

const HOOK = resolve(__dirname, "../../hooks/subagent-context-budget.mjs");

/** Run the real hook as a subprocess with a JSON payload on stdin. */
function runHook(payload: Record<string, unknown>) {
  const stdout = execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  return stdout.trim();
}

/** Write a one-line subagent transcript whose last assistant usage sums to n. */
function transcript(contextTokens: number): string {
  const dir = mkdtempSync(join(tmpdir(), "subagent-ctx-"));
  const file = join(dir, "agent-a1.jsonl");
  writeFileSync(
    file,
    `${JSON.stringify({
      type: "assistant",
      message: {
        usage: {
          input_tokens: 0,
          cache_read_input_tokens: contextTokens,
          cache_creation_input_tokens: 0,
        },
      },
    })}\n`,
  );
  return file;
}

describe("subagent-context-budget thresholds", () => {
  it("owner-decided constants (2026-08-18): 150K soft / 200K hard / +25K repeat", () => {
    expect(SOFT_THRESHOLD).toBe(150_000);
    expect(HARD_THRESHOLD).toBe(200_000);
    expect(SOFT_REPEAT_STEP).toBe(25_000);
  });
});

describe("subagent-context-budget decide() — soft cadence", () => {
  const base = {
    toolName: "Read",
    toolInput: {},
    state: { lastNotifiedAt: 0 },
  };

  it("below the soft cap → silent", () => {
    expect(decide({ ...base, contextTokens: 149_999 }).action).toBe("silent");
  });

  it("first crossing of the soft cap → soft directive + state", () => {
    const d = decide({ ...base, contextTokens: 150_000 });
    expect(d.action).toBe("soft");
    expect(d.state).toEqual({ lastNotifiedAt: 150_000 });
  });

  it("already notified, still inside the same +25K step → silent", () => {
    const d = decide({
      ...base,
      contextTokens: 170_000,
      state: { lastNotifiedAt: 150_000 },
    });
    expect(d.action).toBe("silent");
  });

  it("+25K past the last notification → soft directive again", () => {
    const d = decide({
      ...base,
      contextTokens: 175_000,
      state: { lastNotifiedAt: 150_000 },
    });
    expect(d.action).toBe("soft");
    expect(d.state).toEqual({ lastNotifiedAt: 175_000 });
  });
});

describe("subagent-context-budget decide() — hard cap + allow-list", () => {
  it("199_999 allows a plain Read; 200_000 denies it", () => {
    expect(
      decide({
        contextTokens: 199_999,
        toolName: "Read",
        toolInput: {},
        state: { lastNotifiedAt: 199_000 },
      }).action,
    ).toBe("silent");
    expect(
      decide({
        contextTokens: 200_000,
        toolName: "Read",
        toolInput: {},
        state: { lastNotifiedAt: 199_000 },
      }).action,
    ).toBe("deny");
  });

  it("denies above the hard cap on EVERY call (no cadence gap)", () => {
    for (const ctx of [200_000, 200_001, 210_000, 600_000]) {
      expect(
        decide({
          contextTokens: ctx,
          toolName: "Edit",
          toolInput: { file_path: "/repo/src/a.ts" },
          state: { lastNotifiedAt: ctx },
        }).action,
      ).toBe("deny");
    }
  });

  it("allow-list: git Bash, pnpm pr:preflight, checkpoint-*.md writes", () => {
    expect(
      isAllowedUnderHardCap("Bash", { command: "git commit -m wip" }),
    ).toBe(true);
    expect(isAllowedUnderHardCap("Bash", { command: "  git push  " })).toBe(
      true,
    );
    expect(
      isAllowedUnderHardCap("Bash", { command: "pnpm pr:preflight --static" }),
    ).toBe(true);
    expect(
      isAllowedUnderHardCap("Write", {
        file_path: "C:/tmp/scratch/checkpoint-a1.md",
      }),
    ).toBe(true);
    expect(
      isAllowedUnderHardCap("Write", { file_path: "/tmp/s/checkpoint-a1.md" }),
    ).toBe(true);
  });

  it("allow-list rejects near-misses (git-ish names, other writes, other tools)", () => {
    expect(isAllowedUnderHardCap("Bash", { command: "github-cli sync" })).toBe(
      false,
    );
    expect(isAllowedUnderHardCap("Bash", { command: "pnpm test" })).toBe(false);
    expect(isAllowedUnderHardCap("Bash", {})).toBe(false);
    expect(
      isAllowedUnderHardCap("Write", { file_path: "/repo/notes/report.md" }),
    ).toBe(false);
    expect(
      isAllowedUnderHardCap("Write", { file_path: "/repo/checkpoint.md" }),
    ).toBe(false);
    expect(
      isAllowedUnderHardCap("Read", { file_path: "/x/checkpoint-a.md" }),
    ).toBe(false);
  });

  it("an allow-listed tool above the hard cap stays silent (hand-back path)", () => {
    expect(
      decide({
        contextTokens: 300_000,
        toolName: "Bash",
        toolInput: { command: "git add -- tools/x.mjs" },
        state: { lastNotifiedAt: 300_000 },
      }).action,
    ).toBe("silent");
  });
});

describe("subagent-context-budget messages + paths", () => {
  it("the ROTATE contract and the resolved checkpoint path are in both messages", () => {
    const path = checkpointPath("a1", { CLAUDE_SCRATCHPAD_DIR: "/scratch" });
    expect(path.replace(/\\/g, "/")).toContain("/scratch/checkpoint-a1.md");
    expect(softMessage(160_000, path)).toContain(`ROTATE: ${path}`);
    expect(softMessage(160_000, path)).toContain("160K");
    expect(hardMessage(210_000, path)).toContain(`ROTATE: ${path}`);
    expect(hardMessage(210_000, path)).toContain("210K");
  });

  it("falls back to a tmp checkpoint dir when no scratchpad is exported", () => {
    const path = checkpointPath("a/1", {}).replace(/\\/g, "/");
    expect(path).toContain("claude-checkpoints/checkpoint-a_1.md");
  });

  it("state path is per-agent under the shared guard-state dir", () => {
    const p = stateFilePath("/repo", "a1").replace(/\\/g, "/");
    expect(p).toContain(".claude/dispatch-guard-state/ctx-a1.json");
  });

  it("missing/corrupt state reads as 0 (fail-open)", () => {
    expect(readState("/nope/none.json")).toEqual({ lastNotifiedAt: 0 });
    expect(readState("x", () => "{not json")).toEqual({ lastNotifiedAt: 0 });
  });
});

describe("subagent-context-budget end-to-end (real hook process)", () => {
  it("denies a Read at ≈210K inside a subagent", () => {
    const out = runHook({
      session_id: "x",
      agent_id: "a1",
      tool_name: "Read",
      tool_input: {},
      transcript_path: transcript(210_000),
    });
    const json = JSON.parse(out);
    expect(json.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(json.hookSpecificOutput.permissionDecisionReason).toContain(
      "ROTATE:",
    );
  });

  it("is silent for the same payload with no agent_id (the lead's own call)", () => {
    expect(
      runHook({
        session_id: "x",
        tool_name: "Read",
        tool_input: {},
        transcript_path: transcript(210_000),
      }),
    ).toBe("");
  });

  it("is silent below the soft cap", () => {
    expect(
      runHook({
        session_id: "x",
        agent_id: "a-low",
        tool_name: "Read",
        tool_input: {},
        transcript_path: transcript(100_000),
      }),
    ).toBe("");
  });

  it("fail-open: malformed stdin and a missing transcript produce no output", () => {
    const bad = execFileSync(process.execPath, [HOOK], {
      input: "{not json",
      encoding: "utf8",
    });
    expect(bad.trim()).toBe("");
    expect(
      runHook({
        agent_id: "a1",
        tool_name: "Read",
        tool_input: {},
        transcript_path: "/definitely/not/here.jsonl",
      }),
    ).toBe("");
  });
});

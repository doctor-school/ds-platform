import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Cover for the #1746 wrap-owner-only guard (PreToolUse): a wrap-initiation
// step is denied unless the session transcript carries the owner's own /wrap.
// Pure seams are imported directly (same pattern as dispatch-guard.spec.ts);
// the spawned block proves the stdin/stdout contract end-to-end.
import {
  decide,
  isWrapInitiation,
  ownerRequestedWrap,
} from "../../hooks/wrap-owner-only.mjs";

const HOOK = fileURLToPath(
  new URL("../../hooks/wrap-owner-only.mjs", import.meta.url),
);
const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const DIR = mkdtempSync(join(tmpdir(), "wrap-owner-only-"));

const line = (o: unknown) => JSON.stringify(o) + "\n";
const userText = (text: string) =>
  line({ type: "user", message: { role: "user", content: text } });
const ownerSlash = userText(
  "<command-name>/wrap</command-name>\n<command-message>wrap</command-message>",
);
const toolResultWithWrap = line({
  type: "user",
  message: {
    role: "user",
    content: [{ type: "tool_result", content: "⛔ … введёт /wrap сам." }],
  },
});
const assistantWrap = line({
  type: "assistant",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "запускаю /wrap" }],
  },
});
const codexOwnerWrap = line({
  type: "response_item",
  payload: {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "Проведи /wrap для этой сессии." }],
  },
});

describe("wrap-owner-only isWrapInitiation()", () => {
  it("flags Skill wrap / run-wrap / wrap-init", () => {
    expect(isWrapInitiation("Skill", { skill: "wrap" })).toBe(true);
    expect(isWrapInitiation("Skill", { skill: "run-wrap" })).toBe(true);
    expect(isWrapInitiation("Skill", { skill: "wrap-init" })).toBe(true);
    expect(isWrapInitiation("Skill", { skill: "handoff-prompt" })).toBe(false);
  });

  it("flags a Read of the run-wrap / run-session-retro skill files only", () => {
    expect(
      isWrapInitiation("Read", {
        file_path: "C:\\r\\apps\\docs\\content\\skills\\run-wrap\\SKILL.md",
      }),
    ).toBe(true);
    expect(
      isWrapInitiation("Read", {
        file_path: "/r/apps/docs/content/skills/run-session-retro/SKILL.md",
      }),
    ).toBe(true);
    expect(
      isWrapInitiation("Read", {
        file_path: "/r/apps/docs/content/skills/handoff-prompt/SKILL.md",
      }),
    ).toBe(false);
  });

  it("flags a retro-agent dispatch, not an ordinary IMPL/review brief", () => {
    expect(
      isWrapInitiation("Agent", {
        description: "session retro",
        prompt: "Run run-session-retro in single-session mode …",
      }),
    ).toBe(true);
    expect(
      isWrapInitiation("Task", { prompt: "Dispatch the ретро сессии agent" }),
    ).toBe(true);
    expect(
      isWrapInitiation("Agent", {
        description: "impl #1746",
        prompt: "Implement the guard per the brief; open a PR.",
      }),
    ).toBe(false);
    expect(isWrapInitiation("Bash", { command: "pnpm wrap" })).toBe(false);
  });
});

describe("wrap-owner-only ownerRequestedWrap()", () => {
  it("accepts Codex response_item owner input and retains event_msg support", () => {
    expect(ownerRequestedWrap(codexOwnerWrap)).toBe(true);
    expect(
      ownerRequestedWrap(
        line({
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Проведи /wrap для этой сессии.",
          },
        }),
      ),
    ).toBe(true);
  });

  it.each(["assistant", "tool", "system", "developer"])(
    "rejects Codex response_item role %s even with input_text",
    (role) => {
      expect(
        ownerRequestedWrap(
          line({
            type: "response_item",
            payload: { role, content: [{ type: "input_text", text: "/wrap" }] },
          }),
        ),
      ).toBe(false);
    },
  );

  it("rejects Codex tool outputs, quoted output blocks and malformed content", () => {
    for (const content of [
      [{ type: "output_text", text: "/wrap" }],
      [{ type: "tool_result", content: "/wrap" }],
      [{ type: "input_text", text: 123 }],
      "/wrap",
      null,
    ]) {
      expect(
        ownerRequestedWrap(
          line({ type: "response_item", payload: { role: "user", content } }),
        ),
      ).toBe(false);
    }
    expect(
      ownerRequestedWrap(
        line({
          type: "response_item",
          payload: { type: "function_call_output", output: "/wrap" },
        }),
      ),
    ).toBe(false);
    expect(
      ownerRequestedWrap(
        line({
          type: "response_item",
          payload: {
            role: "user",
            content: [
              { type: "input_text", text: "дай handoff" },
              { type: "output_text", text: "/wrap" },
            ],
          },
        }),
      ),
    ).toBe(false);
  });
  it("true on the owner's typed slash command", () => {
    expect(ownerRequestedWrap(userText("hi") + ownerSlash)).toBe(true);
  });

  it("true on the bare /wrap token in owner text", () => {
    expect(ownerRequestedWrap(userText("давай /wrap и handoff"))).toBe(true);
    expect(ownerRequestedWrap(userText("сделай /wrap-init"))).toBe(true);
  });

  it("false when /wrap appears only in tool output or assistant text", () => {
    expect(ownerRequestedWrap(toolResultWithWrap + assistantWrap)).toBe(false);
    expect(ownerRequestedWrap(userText("дай handoff"))).toBe(false);
    expect(ownerRequestedWrap("")).toBe(false);
  });
});

describe("wrap-owner-only decide()", () => {
  it("denies a wrap step with no owner /wrap in the transcript", () => {
    expect(
      decide({
        toolName: "Skill",
        toolInput: { skill: "wrap" },
        jsonl: userText("дай handoff"),
      }),
    ).toEqual({ action: "deny" });
  });

  it("silent once the owner typed /wrap; silent for any non-wrap tool", () => {
    expect(
      decide({
        toolName: "Skill",
        toolInput: { skill: "wrap" },
        jsonl: ownerSlash,
      }),
    ).toEqual({ action: "silent" });
    expect(
      decide({ toolName: "Edit", toolInput: { file_path: "x" }, jsonl: "" }),
    ).toEqual({ action: "silent" });
  });
});

describe("wrap-owner-only hook (spawned end-to-end)", () => {
  function run(transcript: string, over: Record<string, unknown> = {}) {
    const transcriptPath = join(
      DIR,
      `t-${Math.random().toString(16).slice(2)}.jsonl`,
    );
    writeFileSync(transcriptPath, transcript);
    return spawnSync(process.execPath, [HOOK], {
      cwd: ROOT,
      encoding: "utf8",
      input: JSON.stringify({
        session_id: "wrap-owner-only-spec",
        transcript_path: transcriptPath,
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: {
          file_path: resolve(
            ROOT,
            "apps/docs/content/skills/run-wrap/SKILL.md",
          ),
        },
        ...over,
      }),
    });
  }

  it("deny JSON on stdout when the owner never typed /wrap", () => {
    const r = run(userText("дай handoff"));
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain(
      "handoff-prompt",
    );
  });

  it("silent (no stdout) once the owner typed /wrap", () => {
    const r = run(ownerSlash);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("allows the actual Codex owner message shape through the CLI", () => {
    const r = run(codexOwnerWrap);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("denies missing evidence and gives a normal-text Codex invocation", () => {
    for (const transcript_path of [undefined, join(DIR, "missing.jsonl")]) {
      const r = run(codexOwnerWrap, { transcript_path });
      expect(r.status).toBe(0);
      const out = JSON.parse(r.stdout).hookSpecificOutput;
      expect(out.permissionDecision).toBe("deny");
      expect(out.permissionDecisionReason).toContain(
        "Проведи /wrap для этой сессии.",
      );
    }
  });

  it("silent for a subagent and for a non-wrap tool", () => {
    expect(run(userText("x"), { agent_id: "a1" }).stdout).toBe("");
    expect(
      run(userText("x"), {
        tool_name: "Bash",
        tool_input: { command: "ls" },
      }).stdout,
    ).toBe("");
  });
});

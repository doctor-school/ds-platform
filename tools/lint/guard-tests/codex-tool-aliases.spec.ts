import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { actorIdentity } from "../../hooks/hook-compat.mjs";
import { stateFilePath } from "../../hooks/dispatch-guard.mjs";

const root = resolve(__dirname, "../../..");
const dir = mkdtempSync(join(tmpdir(), "ds-codex-aliases-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const registrations = JSON.parse(
  readFileSync(join(root, ".codex/hooks.json"), "utf8"),
).hooks.PreToolUse as { matcher: string; hooks: { command: string }[] }[];
const spawns = [
  "Agent",
  "Task",
  "spawn_agent",
  "collaboration.spawn_agent",
  "collaborationspawn_agent",
];
const followups = [
  "followup_task",
  "collaboration.followup_task",
  "collaborationfollowup_task",
];
const messages = [
  "send_message",
  "collaboration.send_message",
  "collaborationsend_message",
  "unknown.spawn_agent",
];
const transcript = join(dir, "lead.jsonl");
writeFileSync(
  transcript,
  JSON.stringify({
    timestamp: new Date().toISOString(),
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        model_context_window: 200000,
        last_token_usage: { input_tokens: 170000 },
      },
    },
  }),
);

function registered(guard: string, tool: string) {
  return registrations.some(
    (entry) =>
      entry.hooks.some((hook) => hook.command.endsWith(` ${guard}`)) &&
      new RegExp(entry.matcher).test(tool),
  );
}
function invoke(
  guard: string,
  tool: string,
  extra: Record<string, unknown> = {},
) {
  const result = spawnSync(
    process.execPath,
    [join(root, "tools/hooks", `${guard}.mjs`)],
    {
      encoding: "utf8",
      input: JSON.stringify({
        cwd: dir,
        session_id: tool,
        tool_name: tool,
        transcript_path: transcript,
        ...extra,
      }),
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: "",
        CODEX_PROJECT_DIR: "",
        DS_HOOK_HARNESS: "codex",
        DS_DISPATCH_GUARD_DISABLE: "",
      },
    },
  );
  expect(result.status, result.stderr).toBe(0);
  return result.stdout ? JSON.parse(result.stdout) : {};
}
function routed(
  guard: string,
  tool: string,
  extra: Record<string, unknown> = {},
) {
  expect(registered(guard, tool), `${guard} registration for ${tool}`).toBe(
    true,
  );
  return invoke(guard, tool, extra);
}

describe("Codex observed tool aliases #1919", () => {
  it.each(spawns)(
    "EARS-1: registered %s dispatch is denied at the measured lead fence",
    (tool) => {
      expect(
        routed("lead-context-budget", tool).hookSpecificOutput
          .permissionDecision,
      ).toBe("deny");
    },
  );
  it.each(spawns)(
    "EARS-2: registered %s resets the persisted lead mutation streak",
    (tool) => {
      const identity = {
        cwd: dir,
        session_id: tool,
        transcript_path: transcript,
      };
      for (let i = 0; i < 2; i++)
        routed("dispatch-guard", "Edit", {
          ...identity,
          tool_input: { file_path: "a.ts" },
        });
      routed("dispatch-guard", tool);
      expect(
        JSON.parse(
          readFileSync(stateFilePath(dir, actorIdentity(identity)), "utf8"),
        ).streak,
      ).toBe(0);
    },
  );
  it.each(followups)(
    "EARS-3: ordinary %s rework remains allowed and does not reset dispatch accounting",
    (tool) => {
      expect(registered("lead-context-budget", tool)).toBe(false);
      expect(invoke("lead-context-budget", tool)).toEqual({});
      invoke("dispatch-guard", "Edit", { session_id: tool });
      invoke("dispatch-guard", tool);
      expect(
        JSON.parse(
          readFileSync(
            stateFilePath(
              dir,
              actorIdentity({ session_id: tool, transcript_path: transcript }),
            ),
            "utf8",
          ),
        ).streak,
      ).toBe(1);
    },
  );
  it.each(messages)(
    "EARS-4: %s is not classified as a new dispatch",
    (tool) => {
      for (const guard of ["dispatch-guard", "lead-context-budget"]) {
        expect(registered(guard, tool)).toBe(false);
        expect(
          invoke(guard, tool, {
            tool_input: { message: "Finish the existing PR review" },
          }),
        ).toEqual({});
      }
    },
  );
});

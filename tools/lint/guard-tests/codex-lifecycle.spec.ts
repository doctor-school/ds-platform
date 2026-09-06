import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { patchPaths, actorIdentity } from "../../hooks/hook-compat.mjs";
import {
  contextTokensFromJsonl,
  contextReadingFromJsonl,
  codexBudgetDecision,
} from "../../hooks/context-budget.mjs";
import {
  isWrapInitiation,
  ownerRequestedWrap,
} from "../../hooks/wrap-owner-only.mjs";
import {
  isAllowedUnderHardCap,
  checkpointPath,
} from "../../hooks/subagent-context-budget.mjs";

const root = resolve(__dirname, "../../..");
const dir = mkdtempSync(join(tmpdir(), "ds-codex-guards-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const run = (name: string, input: unknown) =>
  spawnSync(process.execPath, [resolve(root, "tools/hooks", name + ".mjs")], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: "",
      CODEX_PROJECT_DIR: "",
      DS_HOOK_HARNESS: "codex",
    },
  });
const patch = "*** Begin Patch\n*** Add File: src/a.ts\n+hello\n*** End Patch";
const token = (n: number) =>
  JSON.stringify({
    timestamp: new Date().toISOString(),
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        model_context_window: 200000,
        last_token_usage: { input_tokens: n, cached_input_tokens: n - 1 },
      },
    },
  });

describe("Codex hook regression #1919", () => {
  it("extracts canonical, object patch and defensive freeform payloads; rejects malformed input", () => {
    for (const input of [patch, { command: patch }, { patch }])
      expect(patchPaths(input, dir)).toEqual([resolve(dir, "src/a.ts")]);
    for (const input of [
      {},
      { command: 42 },
      "*** Begin Patch\n*** Update File:\n*** End Patch",
      "hello",
      "*** Begin Patch\n*** End Patch",
    ])
      expect(() => patchPaths(input, dir)).toThrow();
  });
  it("keeps parent and sibling agent identities distinct despite a shared session id", () => {
    expect(actorIdentity({ session_id: "parent" })).not.toBe(
      actorIdentity({ session_id: "parent", agent_id: "child" }),
    );
    expect(actorIdentity({ session_id: "parent", agent_id: "child" })).not.toBe(
      actorIdentity({ session_id: "parent", agent_id: "sibling" }),
    );
  });
  it("uses measured Codex window bands and rejects stale/missing-window telemetry", () => {
    for (const [n, expected] of [
      [139999, "silent"],
      [140000, "soft"],
      [169999, "soft"],
      [170000, "deny"],
    ] as const)
      expect(codexBudgetDecision(contextReadingFromJsonl(token(n)))).toBe(
        expected,
      );
    expect(
      codexBudgetDecision(
        contextReadingFromJsonl(token(170000).replace(/200000/, "null")),
      ),
    ).toBe("unavailable");
    expect(
      codexBudgetDecision(
        contextReadingFromJsonl(token(170000), Date.now() + 31 * 60000),
      ),
    ).toBe("unavailable");
  });
  it("reports missing or invalid context as unavailable, never zero", () => {
    expect(contextTokensFromJsonl("")).toBeNull();
    expect(contextTokensFromJsonl(token(-1))).toBeNull();
    expect(contextTokensFromJsonl(token(160000))).toBe(160000);
  });
  it("matches Codex wrap dispatch and shell skill-read, rejects tool output authorization", () => {
    expect(
      isWrapInitiation("spawn_agent", {
        message: "Run run-session-retro for this session",
      }),
    ).toBe(true);
    expect(
      isWrapInitiation("Bash", {
        command: "Get-Content apps/docs/content/skills/run-wrap/SKILL.md",
      }),
    ).toBe(true);
    expect(
      ownerRequestedWrap(
        JSON.stringify({
          type: "event_msg",
          payload: { type: "user_message", message: "/wrap" },
        }),
      ),
    ).toBe(true);
    expect(
      ownerRequestedWrap(
        JSON.stringify({
          type: "response_item",
          payload: { type: "function_call_output", output: "/wrap" },
        }),
      ),
    ).toBe(false);
  });
  it("gates wrap on followup_task while ordinary child completion remains allowed", () => {
    expect(
      isWrapInitiation("followup_task", { message: "Run run-session-retro" }),
    ).toBe(true);
    expect(
      isWrapInitiation("followup_task", {
        message: "Finish the existing PR review",
      }),
    ).toBe(false);
  });
  it("denies relevant wrap if the transcript is missing or unreadable", () => {
    for (const transcript_path of [undefined, join(dir, "missing.jsonl")]) {
      const result = run("wrap-owner-only", {
        cwd: dir,
        tool_name: "spawn_agent",
        tool_input: { message: "run-session-retro" },
        transcript_path,
      });
      expect(
        JSON.parse(result.stdout).hookSpecificOutput.permissionDecision,
      ).toBe("deny");
    }
  });
  it("does not treat the parent transcript as a Codex child context", () => {
    const path = join(dir, "parent.jsonl");
    writeFileSync(path, token(300000));
    const result = run("subagent-context-budget", {
      cwd: dir,
      session_id: "parent",
      agent_id: "child",
      transcript_path: path,
      tool_name: "Bash",
      tool_input: { command: "Get-Location" },
    });
    expect(result.stdout).toContain("unavailable");
    expect(result.stdout).not.toContain('"deny"');
  });
  it("enforces lead budget on canonical spawn and preserves simple git under the child cap", () => {
    const path = join(dir, "lead.jsonl");
    writeFileSync(path, token(170000));
    expect(
      JSON.parse(
        run("lead-context-budget", {
          cwd: dir,
          tool_name: "spawn_agent",
          transcript_path: path,
        }).stdout,
      ).hookSpecificOutput.permissionDecision,
    ).toBe("deny");
    expect(isAllowedUnderHardCap("exec_command", { cmd: "git status" })).toBe(
      true,
    );
    for (const command of [
      "git status > x",
      "git -c alias.x=!whoami x",
      "git status; pnpm test",
      "git status\r\npnpm test",
    ])
      expect(isAllowedUnderHardCap("Bash", { command })).toBe(false);
  });
  it("measures only an identified Codex child transcript and allows only its own checkpoint", () => {
    const path = join(dir, "child.jsonl");
    writeFileSync(
      path,
      JSON.stringify({
        type: "session_meta",
        payload: { id: "child", cwd: dir },
      }) +
        "\n" +
        token(180000),
    );
    const input = {
      cwd: dir,
      session_id: "parent",
      agent_id: "child",
      transcript_path: path,
      tool_name: "Bash",
      tool_input: { command: "Get-Location" },
    };
    expect(
      JSON.parse(run("subagent-context-budget", input).stdout)
        .hookSpecificOutput.permissionDecision,
    ).toBe("deny");
    expect(
      isAllowedUnderHardCap(
        "apply_patch",
        { command: patch.replace("src/a.ts", checkpointPath("child")) },
        "child",
      ),
    ).toBe(true);
    expect(
      isAllowedUnderHardCap(
        "Write",
        { file_path: checkpointPath("sibling") },
        "child",
      ),
    ).toBe(false);
    expect(
      run("subagent-context-budget", { ...input, agent_id: "sibling" }).stdout,
    ).toContain("unavailable");
  });
  it("fails closed for unparseable mutation events", () => {
    expect(run("worktree-path-guard", "{broken").status).toBe(2);
    expect(
      run("worktree-path-guard", {
        cwd: dir,
        tool_name: "apply_patch",
        tool_input: { unknown: patch },
      }).status,
    ).toBe(2);
  });
  it("uses registered git identity for arbitrary worktree locations and symlink escapes", () => {
    const main = join(dir, "main");
    const wt = join(dir, "isolated");
    mkdirSync(main);
    execFileSync("git", ["init", main], { stdio: "ignore" });
    execFileSync(
      "git",
      [
        "-C",
        main,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "--allow-empty",
        "-m",
        "fixture",
      ],
      { stdio: "ignore" },
    );
    execFileSync("git", ["-C", main, "worktree", "add", "-b", "fixture", wt], {
      stdio: "ignore",
    });
    const call = (tool_input: unknown, tool_name = "apply_patch") =>
      run("worktree-path-guard", { cwd: wt, tool_name, tool_input });
    expect(call({ command: patch }).status).toBe(0);
    expect(
      call({ command: patch.replace("src/a.ts", join(main, "a.ts")) }).status,
    ).toBe(2);
    expect(
      call(
        {
          command: `Set-Content -LiteralPath '${join(main, "a.ts")}' -Value bad`,
        },
        "Bash",
      ).status,
    ).toBe(2);
    expect(call({ command: "Get-Location" }, "Bash").status).toBe(0);
    symlinkSync(main, join(wt, "escape"), "junction");
    expect(
      call({ command: patch.replace("src/a.ts", "escape/new.ts") }).status,
    ).toBe(2);
    expect(
      call({ command: patch.replace("src/a.ts", "../main/new.ts") }).status,
    ).toBe(2);
  });
});

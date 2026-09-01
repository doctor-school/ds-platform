import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { bridgeKind, TARGET_REL } from "../../agent/ensure-codex-skills.mjs";
import { contextTokensFromJsonl } from "../../hooks/context-budget.mjs";
import { patchPaths } from "../../hooks/hook-compat.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");
const WORKTREE_GUARD = resolve(ROOT, "tools/hooks/worktree-path-guard.mjs");
const DISPATCH_GUARD = resolve(ROOT, "tools/hooks/dispatch-guard.mjs");
const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length)
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("Codex project configuration", () => {
  it("wires canonical Codex tool names and cross-platform root-derived commands", () => {
    const config = JSON.parse(
      readFileSync(resolve(ROOT, ".codex/hooks.json"), "utf8"),
    );
    const pre = config.hooks.PreToolUse;
    expect(
      pre.some((group: { matcher: string }) =>
        group.matcher.includes("apply_patch"),
      ),
    ).toBe(true);
    expect(
      pre.some((group: { matcher: string }) =>
        group.matcher.includes("spawn_agent"),
      ),
    ).toBe(true);
    expect(
      pre.some((group: { matcher: string }) =>
        group.matcher.includes("mcp__.*__browser_"),
      ),
    ).toBe(true);
    for (const groups of Object.values(config.hooks) as Array<
      Array<{ hooks: Array<{ command: string; commandWindows: string }> }>
    >) {
      for (const group of groups) {
        for (const hook of group.hooks) {
          expect(hook.command).toContain("git rev-parse --show-toplevel");
          expect(hook.commandWindows).toContain(
            "git rev-parse --show-toplevel",
          );
          expect(hook.commandWindows).toContain("powershell -NoProfile");
        }
      }
    }
  });

  it.runIf(process.platform === "win32")(
    "preserves Stop hook exit codes through the configured Windows wrappers",
    () => {
      const config = JSON.parse(
        readFileSync(resolve(ROOT, ".codex/hooks.json"), "utf8"),
      );
      const stopHooks = config.hooks.Stop[0].hooks as Array<{
        commandWindows: string;
      }>;
      expect(stopHooks).toHaveLength(2);

      for (const hook of stopHooks) {
        const blocked = spawnSync(hook.commandWindows, {
          cwd: ROOT,
          input: JSON.stringify({
            session_id: "codex-stop-exit-code",
            cwd: ROOT,
            hook_event_name: "Stop",
            stop_hook_active: false,
            last_assistant_message: "PR #1615 merged.",
          }),
          encoding: "utf8",
          shell: true,
        });
        expect(blocked.status, blocked.stderr).toBe(2);

        const allowed = spawnSync(hook.commandWindows, {
          cwd: ROOT,
          input: JSON.stringify({
            session_id: "codex-stop-allow",
            cwd: ROOT,
            hook_event_name: "Stop",
            stop_hook_active: true,
          }),
          encoding: "utf8",
          shell: true,
        });
        expect(allowed.status, allowed.stderr).toBe(0);
        expect(JSON.parse(allowed.stdout)).toEqual({});
      }
    },
  );

  it("defines read-only explorer and independent Mode (a) reviewer agents", () => {
    const projectConfig = readFileSync(
      resolve(ROOT, ".codex/config.toml"),
      "utf8",
    );
    const explorer = readFileSync(
      resolve(ROOT, ".codex/agents/ds-explorer.toml"),
      "utf8",
    );
    const reviewer = readFileSync(
      resolve(ROOT, ".codex/agents/ds-reviewer.toml"),
      "utf8",
    );
    for (const source of [explorer, reviewer]) {
      expect(source).toMatch(/^name\s*=\s*".+"/m);
      expect(source).toMatch(/^description\s*=\s*".+"/m);
      expect(source).toMatch(/^developer_instructions\s*=\s*"""/m);
      expect(source).toContain('sandbox_mode = "read-only"');
      expect(source).not.toMatch(/^model\s*=/m);
    }
    expect(reviewer).toContain("APPROVE or REQUEST_CHANGES");
    expect(reviewer).toContain("Never edit repository files");
    expect(explorer).toMatch(/^name\s*=\s*"ds-explorer"/m);
    expect(reviewer).toMatch(/^name\s*=\s*"ds-reviewer"/m);
    expect(projectConfig).toMatch(/^hooks\s*=\s*true$/m);
    expect(projectConfig).toMatch(/^enabled\s*=\s*true$/m);
  });
});

describe("canonical skill bridge", () => {
  it("is committed as a relative Git symlink, never a copied catalog", () => {
    const row = execFileSync(
      "git",
      ["ls-files", "-s", "--", ".agents/skills"],
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    ).trim();
    expect(row).toMatch(/^120000\s+[0-9a-f]{40,64}\s+0\s+\.agents\/skills$/);
    const blob = row.split(/\s+/)[1];
    expect(
      execFileSync("git", ["cat-file", "-p", blob], {
        cwd: ROOT,
        encoding: "utf8",
      }),
    ).toBe(TARGET_REL);
  });

  it("recognizes a Windows Git placeholder only when its target is exact", () => {
    const fileStat = {
      isSymbolicLink: () => false,
      isDirectory: () => false,
      isFile: () => true,
    };
    expect(bridgeKind(fileStat, TARGET_REL)).toBe("git-placeholder");
    expect(bridgeKind(fileStat, "../somewhere-else")).toBe("invalid");
  });

  it("runs deterministic materialization during install and bootstrap", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts["agent:setup"]).toContain("ensure-codex-skills.mjs");
    expect(pkg.scripts.prepare).toContain("pnpm agent:setup");
    expect(pkg.scripts.bootstrap).toContain("pnpm agent:setup");
  });
});

describe("Codex apply_patch compatibility", () => {
  it("extracts add/update/delete paths and the real Move to destination syntax", () => {
    const command = [
      "*** Begin Patch",
      "*** Update File: src/a.ts",
      "*** Move to: ../escaped.ts",
      "*** Add File: src/b.ts",
      "*** Delete File: src/c.ts",
      "*** End Patch",
    ].join("\n");
    expect(patchPaths({ command }, resolve(ROOT, "sandbox"))).toEqual([
      resolve(ROOT, "sandbox/src/a.ts"),
      resolve(ROOT, "escaped.ts"),
      resolve(ROOT, "sandbox/src/b.ts"),
      resolve(ROOT, "sandbox/src/c.ts"),
    ]);
  });

  it("blocks a Codex move whose destination escapes an isolated worktree", () => {
    const main = resolve(ROOT, "..", "fake-main");
    const cwd = resolve(main, ".claude/worktrees/1243");
    const escaped = resolve(main, "src/escaped.ts");
    const result = spawnSync(process.execPath, [WORKTREE_GUARD], {
      input: JSON.stringify({
        session_id: "codex-move",
        cwd,
        tool_name: "apply_patch",
        tool_input: {
          command: `*** Begin Patch\n*** Update File: src/a.ts\n*** Move to: ${escaped}\n*** End Patch`,
        },
      }),
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("SHARED main tree");
    expect(result.stderr).toContain(escaped);
  });
});

describe("canonical Codex hook payloads (spawned end-to-end)", () => {
  it("counts apply_patch calls and resets on spawn_agent", () => {
    const cwd = mkdtempSync(resolve(tmpdir(), "codex-dispatch-"));
    tempDirs.push(cwd);
    const run = (tool_name: string, tool_input: object) =>
      spawnSync(process.execPath, [DISPATCH_GUARD], {
        input: JSON.stringify({
          session_id: "codex-dispatch-shape",
          cwd,
          hook_event_name: "PreToolUse",
          tool_name,
          tool_input,
        }),
        encoding: "utf8",
      });
    const patch = {
      command: "*** Begin Patch\n*** Update File: src/a.ts\n*** End Patch",
    };
    expect(run("apply_patch", patch).stdout).toBe("");
    expect(run("apply_patch", patch).stdout).toBe("");
    expect(
      JSON.parse(run("apply_patch", patch).stdout).systemMessage,
    ).toContain("dispatch guard");
    expect(
      run("spawn_agent", { task_name: "impl", message: "work" }).stdout,
    ).toBe("");
    expect(run("apply_patch", patch).stdout).toBe("");
  });

});

describe("Codex context-budget fallback", () => {
  it("uses last_token_usage.input_tokens without double-counting cached input", () => {
    const jsonl = JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 125_429,
            cached_input_tokens: 124_672,
          },
        },
      },
    });
    expect(contextTokensFromJsonl(jsonl)).toBe(125_429);
  });

  it("preserves Claude usage accounting", () => {
    const jsonl = JSON.stringify({
      type: "assistant",
      message: {
        usage: {
          input_tokens: 10,
          cache_read_input_tokens: 20,
          cache_creation_input_tokens: 30,
        },
      },
    });
    expect(contextTokensFromJsonl(jsonl)).toBe(60);
  });
});

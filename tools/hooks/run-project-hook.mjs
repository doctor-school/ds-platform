#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { recordObservation } from "./observations.mjs";
import { projectRoot } from "./hook-compat.mjs";
import { ensureCodexSkillBridge } from "../agent/ensure-codex-skills.mjs";

try {
  const raw = readFileSync(0, "utf8");
  const payload = raw.trim() ? JSON.parse(raw) : {};
  const root = projectRoot(payload);
  const task = process.argv[2];
  const guards = new Set([
    "worktree-path-guard",
    "dispatch-guard",
    "context-budget",
    "lead-context-budget",
    "subagent-context-budget",
    "wrap-owner-only",
    "screenshot-path-guard",
  ]);
  const env = {
    ...process.env,
    DS_HOOK_HARNESS: "codex",
    DS_HOOK_SESSION_ID: payload.session_id || "",
  };
  if (guards.has(task)) {
    const result = spawnSync(
      process.execPath,
      [resolve(root, "tools/hooks", task + ".mjs")],
      { cwd: root, env, input: raw, encoding: "utf8", timeout: 8000 },
    );
    let decision;
    try {
      decision = JSON.parse(result.stdout)?.hookSpecificOutput
        ?.permissionDecision;
    } catch {
      /* silent success or exit 2 */
    }
    recordObservation(
      root,
      payload,
      task,
      result.status,
      decision || (result.status === 2 ? "deny" : null),
    );
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error)
      process.stderr.write(`[project-hook] ${result.error.message}\n`);
    process.exit(result.status ?? 2);
  }
  if (task !== "bootstrap") throw new Error("unknown project hook task");
  ensureCodexSkillBridge(root);
  const result =
    process.platform === "win32"
      ? spawnSync(
          process.env.ComSpec || "cmd.exe",
          ["/d", "/s", "/c", "pnpm exec tsx tools/agent-bootstrap.ts"],
          { cwd: root, env, encoding: "utf8", timeout: 55000 },
        )
      : spawnSync("pnpm", ["exec", "tsx", "tools/agent-bootstrap.ts"], {
          cwd: root,
          env,
          timeout: 55000,
          encoding: "utf8",
        });
  recordObservation(root, payload, task, result.status, null);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
} catch (error) {
  process.stderr.write(
    `[project-hook] ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(process.argv[2] === "bootstrap" ? 1 : 2);
}

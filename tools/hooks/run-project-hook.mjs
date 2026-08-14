#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { projectRoot } from "./hook-compat.mjs";
import { ensureCodexSkillBridge } from "../agent/ensure-codex-skills.mjs";

try {
  const raw = readFileSync(0, "utf8");
  const payload = raw.trim() ? JSON.parse(raw) : {};
  const root = projectRoot(payload);
  const task = process.argv[2];
  if (task !== "bootstrap") process.exit(0);
  ensureCodexSkillBridge(root);
  const result =
    process.platform === "win32"
      ? spawnSync(
          process.env.ComSpec || "cmd.exe",
          ["/d", "/s", "/c", "pnpm exec tsx tools/agent-bootstrap.ts"],
          { cwd: root, encoding: "utf8" },
        )
      : spawnSync("pnpm", ["exec", "tsx", "tools/agent-bootstrap.ts"], {
          cwd: root,
          encoding: "utf8",
        });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
} catch (error) {
  process.stderr.write(
    `[project-hook] ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}

#!/usr/bin/env node
/** Bounded fresh-session hook smoke. Preparation writes ONLY a new temp git
 * fixture. Run never changes trust, sandbox defaults, or user's global config. */
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { diagnoseHooks } from "./doctor.mjs";
const source = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const marker = "ds-platform-codex-hook-smoke-v1";
const args = process.argv.slice(2);
if (args[0] === "--prepare") {
  const fixture = mkdtempSync(resolve(tmpdir(), "ds-codex-hook-smoke-"));
  mkdirSync(resolve(fixture, ".codex"));
  mkdirSync(resolve(fixture, "tools/agent"), { recursive: true });
  cpSync(resolve(source, "tools/hooks"), resolve(fixture, "tools/hooks"), {
    recursive: true,
  });
  cpSync(
    resolve(source, "tools/agent/ensure-codex-skills.mjs"),
    resolve(fixture, "tools/agent/ensure-codex-skills.mjs"),
  );
  const hooks = JSON.parse(
    readFileSync(resolve(source, ".codex/hooks.json"), "utf8"),
  );
  // Bootstrap needs the monorepo dependencies/network. The fixture only tests
  // the unchanged PreToolUse and prompt guards; it never claims bootstrap proof.
  delete hooks.hooks.SessionStart;
  writeFileSync(
    resolve(fixture, ".codex/hooks.json"),
    JSON.stringify(hooks, null, 2) + "\n",
  );
  cpSync(
    resolve(source, ".codex/config.toml"),
    resolve(fixture, ".codex/config.toml"),
  );
  writeFileSync(
    resolve(fixture, "fixture.json"),
    JSON.stringify(
      { marker, source, createdAt: new Date().toISOString() },
      null,
      2,
    ),
  );
  writeFileSync(
    resolve(fixture, "AGENTS.md"),
    "Temporary hook verification fixture. Only read-only commands are authorized. Do not edit any file, start a subagent, call external services, change permissions or trust, or inspect unrelated directories.\n",
  );
  execFileSync("git", ["init", fixture], { stdio: "ignore" });
  const prompt =
    "This is a bounded hook smoke. Run exactly one read-only shell command: git status --short. Do not run additional tools or subagents. Report the command outcome and any hook messages, then stop.";
  writeFileSync(resolve(fixture, "prompt.txt"), prompt);
  process.stdout.write(
    JSON.stringify(
      {
        fixture,
        prepared: true,
        scope:
          "Unchanged PreToolUse and prompt guard scripts; bootstrap and subagent dispatch not exercised.",
        run: `pnpm agent:smoke --run "${fixture}"`,
        ownerAction: `If hooks are skipped, open Codex in "${fixture}", use /hooks to review and trust its exact definitions, then rerun. No trust bypass.`,
      },
      null,
      2,
    ) + "\n",
  );
} else if (args[0] === "--project" || (args[0] === "--run" && args[1])) {
  const projectMode = args[0] === "--project";
  const fixture = projectMode ? source : resolve(args[1]);
  const evidenceDir = projectMode
    ? mkdtempSync(resolve(tmpdir(), "ds-codex-project-smoke-"))
    : fixture;
  const expectedPrefix = resolve(tmpdir(), "ds-codex-hook-smoke-");
  if (
    !projectMode &&
    (!fixture.startsWith(expectedPrefix) ||
      !existsSync(resolve(fixture, "fixture.json")) ||
      JSON.parse(readFileSync(resolve(fixture, "fixture.json"), "utf8"))
        .marker !== marker)
  )
    throw new Error("Expected a prepared temp smoke fixture");
  const prompt = projectMode
    ? "This is a bounded read-only engineering verification of configured Codex hooks, not implementation. Run exactly one read-only shell command: git status --short. Do not run additional tools or subagents, edit files, change trust, access services, or start a task lifecycle. Report the command outcome and hook messages, then stop."
    : readFileSync(resolve(fixture, "prompt.txt"), "utf8");
  const command = [
    "exec",
    "--json",
    "--sandbox",
    "read-only",
    "-C",
    fixture,
    "-",
  ];
  // cmd/PowerShell quoting is avoided: resolve the npm shim's JS CLI entry.
  const cli = process.env.APPDATA
    ? resolve(
        process.env.APPDATA,
        "npm/node_modules/@openai/codex/bin/codex.js",
      )
    : null;
  const result =
    cli && existsSync(cli)
      ? spawnSync(process.execPath, [cli, ...command], {
          input: prompt,
          encoding: "utf8",
          timeout: 90000,
          maxBuffer: 2 * 1024 * 1024,
        })
      : spawnSync("codex", command, {
          input: prompt,
          encoding: "utf8",
          timeout: 90000,
          maxBuffer: 2 * 1024 * 1024,
        });
  writeFileSync(
    resolve(evidenceDir, "runtime.stdout.jsonl"),
    result.stdout || "",
  );
  writeFileSync(
    resolve(evidenceDir, "runtime.stderr.txt"),
    result.stderr || "",
  );
  const diagnosis = diagnoseHooks(fixture);
  const report = {
    fixture,
    evidenceDir,
    exitCode: result.status,
    error: result.error?.message || null,
    observed: diagnosis.observed,
    trusted: diagnosis.trusted,
    evidence: ["runtime.stdout.jsonl", "runtime.stderr.txt"],
    ownerAction: diagnosis.ownerAction,
  };
  writeFileSync(
    resolve(fixture, "runtime-report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exitCode = result.status ?? 1;
} else {
  process.stderr.write(
    "Usage: pnpm agent:smoke --project | --prepare | --run <prepared-temp-fixture>\n",
  );
  process.exitCode = 1;
}

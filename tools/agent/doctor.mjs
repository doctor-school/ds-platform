#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectRoot } from "../hooks/hook-compat.mjs";
import { hookFingerprint, readObservations } from "../hooks/observations.mjs";
export function diagnoseHooks(
  root,
  rows = readObservations(root),
  nowMs = Date.now(),
) {
  const config = JSON.parse(
    readFileSync(resolve(root, ".codex/hooks.json"), "utf8"),
  );
  const fingerprint = hookFingerprint(root);
  const recent = rows.filter(
    (r) =>
      r.fingerprint === fingerprint &&
      Number.isFinite(Date.parse(r.at)) &&
      nowMs - Date.parse(r.at) >= 0 &&
      nowMs - Date.parse(r.at) <= 24 * 3600000,
  );
  const configured = Object.entries(config.hooks).flatMap(([event, groups]) =>
    groups.flatMap((g) =>
      g.hooks.map((h) => ({
        event,
        matcher: g.matcher || "*",
        command: h.command,
        windowsCommand: h.commandWindows || null,
      })),
    ),
  );
  return {
    root,
    fingerprint,
    configured: { source: ".codex/hooks.json", handlers: configured },
    trusted: {
      status: "unknown",
      reason:
        "Project-layer and exact hook-definition trust are host-owned. Inspect /hooks in the target CLI/app; configuration and command-execution logs do not prove persisted trust.",
    },
    observed: {
      status: recent.length
        ? "hook-command execution recorded"
        : "not observed",
      scope:
        "Local command-execution evidence only; synthetic invocation is possible. Fresh-session CLI smoke is separate evidence.",
      events: [...new Set(recent.map((r) => r.event))],
      tools: [...new Set(recent.map((r) => r.tool).filter(Boolean))],
      guards: [...new Set(recent.map((r) => r.task))],
      denials: recent.filter((r) => r.decision === "deny").length,
    },
    limits: [
      "Transcript telemetry is unstable; missing identity, usage, freshness or model window is unavailable, never zero.",
      "Codex context bands: current input / reported effective model window; 70% finish wave, 85% refuse dispatch/rotate. No cached-input double count.",
      "Shell writers use bounded literal parsing; package scripts, aliases, interpreters, interactive stdin and specialized tool paths are not an exhaustive sandbox.",
      "Hosted tools are outside documented local hooks; functions.exec/nested-call behavior requires observation in the active host.",
    ],
    ownerAction:
      "After landing, start a fresh Codex session in ds-platform, trust the project layer if prompted, open /hooks and review/trust the updated project definitions. Then run pnpm agent:smoke --project. Do not enable trust bypass.",
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.stdout.write(
      JSON.stringify(
        diagnoseHooks(projectRoot({ cwd: process.argv[2] || process.cwd() })),
        null,
        2,
      ) + "\n",
    );
  } catch (error) {
    process.stderr.write(`[agent:doctor] ${error.message}\n`);
    process.exitCode = 1;
  }
}

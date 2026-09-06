#!/usr/bin/env node
/** Operator-only context advisory. Claude retains 120K/160K tiers. Codex
 * uses current request input / effective model window at 70%/85%, with cache
 * counted once. Missing/stale telemetry is explicit and never a zero reading.
 * No additionalContext: the owner decides when to /wrap. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { telemetryUnavailable } from "./hook-compat.mjs";

export const WARN_THRESHOLD = 120_000;
export const WRAP_THRESHOLD = 160_000;

/** Last request usage, never lifetime totals. Codex cache is included in input. */
export function contextReadingFromJsonl(jsonl, nowMs = Date.now()) {
  const lines = String(jsonl).split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (entry?.type === "event_msg" && entry?.payload?.type === "token_count") {
      const input = entry?.payload?.info?.last_token_usage?.input_tokens;
      const window = entry?.payload?.info?.model_context_window;
      const timestamp = Date.parse(entry.timestamp);
      const fresh =
        Number.isFinite(timestamp) &&
        nowMs - timestamp <= 30 * 60 * 1000 &&
        timestamp <= nowMs + 60_000;
      return {
        harness: "codex",
        tokens: Number.isFinite(input) && input >= 0 ? input : null,
        window: fresh && Number.isFinite(window) && window > 0 ? window : null,
      };
    }
    const usage = entry?.message?.usage;
    if (entry?.type === "assistant" && usage) {
      const parts = [
        usage.input_tokens,
        usage.cache_read_input_tokens ?? 0,
        usage.cache_creation_input_tokens ?? 0,
      ];
      return {
        harness: "claude",
        tokens: parts.every((n) => Number.isFinite(n) && n >= 0)
          ? parts.reduce((a, b) => a + b, 0)
          : null,
        window: null,
      };
    }
  }
  return { harness: "unknown", tokens: null, window: null };
}
export function contextTokensFromJsonl(jsonl) {
  return contextReadingFromJsonl(jsonl).tokens;
}
export const CODEX_SOFT_RATIO = 0.7;
export const CODEX_HARD_RATIO = 0.85;
export function codexBudgetDecision(reading) {
  if (reading.tokens === null || !reading.window) return "unavailable";
  const ratio = reading.tokens / reading.window;
  return ratio >= CODEX_HARD_RATIO
    ? "deny"
    : ratio >= CODEX_SOFT_RATIO
      ? "soft"
      : "silent";
}
export function codexBudgetMessage(reading, action) {
  return (
    `Codex current input ${reading.tokens}/${reading.window} (${Math.round((reading.tokens / reading.window) * 100)}%): ` +
    (action === "deny"
      ? "85% cap: no new dispatch; checkpoint and rotate after receiving running agents and completing recovery/PR tails."
      : "70% warning: finish the current wave and prepare a checkpoint; start no new wave.") +
    " Headroom is project policy, not a vendor guarantee. /wrap remains owner-only."
  );
}

function main() {
  try {
    const stdin = readFileSync(0, "utf8");
    const { transcript_path: transcriptPath } = JSON.parse(stdin);
    if (!transcriptPath) throw new Error("missing transcript");
    const reading = contextReadingFromJsonl(
      readFileSync(transcriptPath, "utf8"),
    );
    if (
      process.env.DS_HOOK_HARNESS === "codex" ||
      reading.harness === "codex"
    ) {
      const action = codexBudgetDecision(reading);
      if (action === "unavailable") throw new Error("missing telemetry");
      if (action !== "silent")
        process.stdout.write(
          JSON.stringify({
            systemMessage: codexBudgetMessage(reading, action),
          }),
        );
      process.exit(0);
    }
    const context = reading.tokens;

    if (context === null) throw new Error("missing telemetry");
    if (context >= WRAP_THRESHOLD) {
      const k = Math.round(context / 1000);
      process.stdout.write(
        JSON.stringify({
          systemMessage: `⚠ Контекст лида ≈ ${k}K (порог ${Math.round(WRAP_THRESHOLD / 1000)}K). Волна легла → /wrap + handoff → новая сессия; новую волну здесь не начинать.`,
        }),
      );
    } else if (context >= WARN_THRESHOLD) {
      const k = Math.round(context / 1000);
      process.stdout.write(
        JSON.stringify({
          systemMessage: `⚠ Контекст лида ≈ ${k}K — после текущей волны /wrap + handoff, не новая волна.`,
        }),
      );
    }
    process.exit(0);
  } catch {
    process.stdout.write(JSON.stringify(telemetryUnavailable("Lead")));
    process.exit(0);
  }
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
if (invoked && invoked === resolve(fileURLToPath(import.meta.url))) {
  main();
}

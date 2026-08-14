#!/usr/bin/env node
/**
 * UserPromptSubmit hook: context-budget OPERATOR ADVISORY (owner decision, 2026-07-16).
 *
 * Supersedes the 2026-07-06 / #862 two-tier directive design. That design
 * injected an `additionalContext` block ordering the model to stop taking new
 * work and propose /wrap — the owner found this makes the agent abandon
 * in-flight slices mid-task. This hook now NEVER talks to the model: it is a
 * VISIBLE OPERATOR ADVISORY ONLY, surfaced via `systemMessage` for the human
 * operator to read. It MUST NEVER emit `hookSpecificOutput` / `additionalContext`
 * — the decision to /wrap stays with the human, not the model.
 *
 * It reads the CURRENT session transcript (path arrives on stdin), takes the
 * last assistant message's usage block, and computes the live context size as
 * input_tokens + cache_read_input_tokens + cache_creation_input_tokens.
 * Thresholds are owner-calibrated to the ~150K cache-read cost cliff for the
 * session model (owner research; the operator statusline visualizes the 150K
 * limit) — do not change without an explicit owner directive. Below the first
 * tier: silent, no output.
 *
 * Fail-safe: any parse/IO error exits 0 with no output — a broken budget probe
 * must never break prompting.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WARN_THRESHOLD = 110_000;
export const WRAP_THRESHOLD = 120_000;

export function contextTokensFromJsonl(jsonl) {
  const lines = String(jsonl).split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const usage = entry?.message?.usage;
    if (entry?.type === "assistant" && usage) {
      return (
        (usage.input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0)
      );
    }
    if (entry?.type === "event_msg" && entry?.payload?.type === "token_count") {
      // Codex reports cached input as a subset of input_tokens. Using the last
      // request's input_tokens avoids double-counting the cache component.
      const input = entry?.payload?.info?.last_token_usage?.input_tokens;
      if (Number.isFinite(input)) return input;
    }
  }
  return 0;
}

function main() {
  try {
    const stdin = readFileSync(0, "utf8");
    const { transcript_path: transcriptPath } = JSON.parse(stdin);
    if (!transcriptPath) process.exit(0);
    const context = contextTokensFromJsonl(
      readFileSync(transcriptPath, "utf8"),
    );

    if (context >= WRAP_THRESHOLD) {
      const k = Math.round(context / 1000);
      process.stdout.write(
        JSON.stringify({
          systemMessage: `⚠ Контекст сессии ≈ ${k}K токенов (порог 120K) — каждый следующий ход дорожает кэш-ридами. Пора /wrap.`,
        }),
      );
    } else if (context >= WARN_THRESHOLD) {
      const k = Math.round(context / 1000);
      process.stdout.write(
        JSON.stringify({
          systemMessage: `⚠ Контекст сессии ≈ ${k}K токенов — приближается порог /wrap (120K). Решение за вами.`,
        }),
      );
    }
    process.exit(0);
  } catch {
    process.exit(0);
  }
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
if (invoked && invoked === resolve(fileURLToPath(import.meta.url))) {
  main();
}

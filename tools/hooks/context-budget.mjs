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
 * Thresholds are window-relative (the current session model family is a
 * 1M-token-class window, not the 200K window the old fixed 110K/120K
 * thresholds were calibrated for). Below the first tier: silent, no output.
 *
 * Fail-safe: any parse/IO error exits 0 with no output — a broken budget probe
 * must never break prompting.
 */
import { readFileSync } from "node:fs";

const MODEL_WINDOW = 1_000_000; // Fable/Opus 1M-class window — update when the session model family changes
const ADVISORY_1 = 0.4 * MODEL_WINDOW;
const ADVISORY_2 = 0.6 * MODEL_WINDOW;

try {
  const stdin = readFileSync(0, "utf8");
  const { transcript_path: transcriptPath } = JSON.parse(stdin);
  if (!transcriptPath) process.exit(0);

  const lines = readFileSync(transcriptPath, "utf8").split("\n");
  let context = 0;
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
      context =
        (usage.input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0);
      break;
    }
  }

  if (context >= ADVISORY_2) {
    const k = Math.round(context / 1000);
    process.stdout.write(
      JSON.stringify({
        systemMessage: `⚠ Контекст сессии ≈ ${k}K из 1M (60%+) — сессия тяжёлая; /wrap на вашем усмотрении.`,
      }),
    );
  } else if (context >= ADVISORY_1) {
    const k = Math.round(context / 1000);
    process.stdout.write(
      JSON.stringify({
        systemMessage: `ℹ Контекст сессии ≈ ${k}K из 1M (40%+) — имейте в виду; решение о /wrap за вами.`,
      }),
    );
  }
  process.exit(0);
} catch {
  process.exit(0);
}

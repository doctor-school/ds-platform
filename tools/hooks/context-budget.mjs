#!/usr/bin/env node
/**
 * UserPromptSubmit hook: context-budget guard (owner decision, 2026-07-06).
 *
 * Cache reads scale with context size on every turn, so past ~120K tokens the
 * per-turn cost of continuing outweighs starting a fresh session. This hook
 * reads the CURRENT session transcript (path arrives on stdin), takes the last
 * assistant message's usage block, and computes the live context size as
 * input_tokens + cache_read_input_tokens + cache_creation_input_tokens.
 * Two tiers (#862): in the [WARN_THRESHOLD, WRAP_THRESHOLD) band it emits a
 * pre-threshold warning — finish the current unit and plan the wrap now, do
 * not start units whose verification tail won't fit. At or above
 * WRAP_THRESHOLD it (a) shows the owner a systemMessage and (b) injects
 * an additionalContext directive telling the model to stop taking new work and
 * propose /wrap. It never blocks the prompt — the owner may consciously push
 * past the budget (e.g. to finish an in-flight merge before wrapping).
 *
 * Fail-safe: any parse/IO error exits 0 with no output — a broken budget probe
 * must never break prompting.
 */
import { readFileSync } from "node:fs";

const WARN_THRESHOLD = 110_000;
const WRAP_THRESHOLD = 120_000;

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

  if (context >= WRAP_THRESHOLD) {
    const k = Math.round(context / 1000);
    process.stdout.write(
      JSON.stringify({
        systemMessage: `⚠ Контекст сессии ≈ ${k}K токенов (порог ${WRAP_THRESHOLD / 1000}K) — каждый следующий ход дорожает кэш-ридами. Пора /wrap.`,
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: `<context-budget-guard>Session context is ~${k}K tokens — over the ${WRAP_THRESHOLD / 1000}K wrap threshold (owner policy: wrap instead of multiplying cache reads). Do NOT start new units of work. The bounded closeout of a PR already opened this session IS in-flight — finish it per AGENTS.md §6 PR-lifecycle (Mode-a review dispatch → CI confirm → merge → board Done → teardown), including the review-subagent dispatch. An owner Stage-B on an already-booted stand AND the merge it gates are part of that closeout — finish a completable Stage-B/merge tail in-session (deferring it forces a stand re-boot and an owner re-drive; retro 1e4d515d); defer to the handoff only genuinely un-startable next units. Otherwise finish only the immediately in-flight step (an unanswered owner question), then propose /wrap in your reply. If nothing is in flight, propose /wrap now.</context-budget-guard>`,
        },
      }),
    );
  } else if (context >= WARN_THRESHOLD) {
    const k = Math.round(context / 1000);
    process.stdout.write(
      JSON.stringify({
        systemMessage: `⚠ Контекст сессии ≈ ${k}K токенов — приближается порог /wrap (${WRAP_THRESHOLD / 1000}K). Завершайте текущий юнит и планируйте /wrap СЕЙЧАС; новые юниты, чей верификационный хвост не влезет до порога, не начинать.`,
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: `<context-budget-guard>Session context is ~${k}K tokens — approaching the ${WRAP_THRESHOLD / 1000}K wrap threshold (pre-threshold warn tier at ${WARN_THRESHOLD / 1000}K). Finish the current unit of work and plan the wrap NOW. Do NOT start new units whose verification tail (review dispatch, CI wait, merge, teardown) will not fit before the ${WRAP_THRESHOLD / 1000}K line; when the current unit closes, propose /wrap.</context-budget-guard>`,
        },
      }),
    );
  }
  process.exit(0);
} catch {
  process.exit(0);
}

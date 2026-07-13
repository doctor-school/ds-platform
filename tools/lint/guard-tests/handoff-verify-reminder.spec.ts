import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The hook is plain ESM JS (runs under bare `node` from settings.json), so the
// spec imports its pure seams directly — same pattern as the #824 sibling.
import { isHandoffPrompt } from "../../hooks/handoff-verify-reminder.mjs";

/**
 * Cover for the #839 handoff-verify reminder (UserPromptSubmit hook): a
 * submitted prompt that matches the handoff shape (the continuation sentinel
 * sentence, or the `## Current task` + `## Where we stopped` header pair)
 * emits a visible reminder naming `pnpm handoff:verify`; ordinary prompts
 * emit nothing. Warn-only + fail-open: the hook always exits 0 and any
 * internal error produces no output.
 *
 * All fixtures are pure prompt strings that are never resolved as filesystem
 * paths, so the spec is platform-agnostic by construction (CI runs Linux).
 */

const HOOK = fileURLToPath(
  new URL("../../hooks/handoff-verify-reminder.mjs", import.meta.url),
);

function runHook(payload: unknown) {
  return spawnSync(process.execPath, [HOOK], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
  });
}

const submitPayload = (prompt: string) => ({
  session_id: "s-839",
  hook_event_name: "UserPromptSubmit",
  prompt,
});

const SENTINEL_HANDOFF =
  "You are continuing a previous Claude Code session that ran out of context.\n\n" +
  "## Current task\nIssue #839 — hook seams.\n\n" +
  "## Where we stopped\nPR not yet opened; worktree 839 ready.";

const HEADERS_ONLY_HANDOFF =
  "Продолжай работу по вчерашней сессии.\n\n" +
  "## Current task\nIssue #839.\n\n" +
  "## Where we stopped\nТесты зелёные, PR не открыт.";

describe("handoff-verify-reminder hook (spawned end-to-end)", () => {
  it("reminds `pnpm handoff:verify` on a sentinel-sentence handoff", () => {
    const r = runHook(submitPayload(SENTINEL_HANDOFF));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("pnpm handoff:verify");
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(out.hookSpecificOutput.additionalContext).toContain(
      "pnpm handoff:verify",
    );
    // the reminder must insist on the VERBATIM handoff, not a paraphrase
    expect(out.hookSpecificOutput.additionalContext).toMatch(/verbatim/i);
    expect(out.systemMessage).toContain("pnpm handoff:verify");
  });

  it("reminds on the `## Current task` + `## Where we stopped` header pair", () => {
    const r = runHook(submitPayload(HEADERS_ONLY_HANDOFF));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("pnpm handoff:verify");
  });

  it("stays silent on an ordinary prompt", () => {
    const r = runHook(submitPayload("продолжай — merge PR #838 когда CI зелёный"));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
  });

  it("stays silent on a single header without the sentinel (not a handoff)", () => {
    const r = runHook(
      submitPayload("## Current task\nобнови README секцию Current task"),
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("fails open (exit 0, no output) on garbage stdin", () => {
    const r = runHook("not-json{{{");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("fails open when the prompt field is absent", () => {
    const r = runHook({ session_id: "s", hook_event_name: "UserPromptSubmit" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});

describe("isHandoffPrompt()", () => {
  it("matches the continuation sentinel sentence", () => {
    expect(
      isHandoffPrompt("You are continuing a previous Claude Code session."),
    ).toBe(true);
  });

  it("matches the header pair regardless of surrounding prose", () => {
    expect(isHandoffPrompt(HEADERS_ONLY_HANDOFF)).toBe(true);
  });

  it("rejects ordinary prompts and lone headers", () => {
    expect(isHandoffPrompt("сделай ревью PR #838")).toBe(false);
    expect(isHandoffPrompt("## Current task\nодин заголовок")).toBe(false);
    expect(isHandoffPrompt("## Where we stopped\nодин заголовок")).toBe(false);
    expect(isHandoffPrompt("")).toBe(false);
  });
});

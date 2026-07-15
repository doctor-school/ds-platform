import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The hook is plain ESM JS (runs under bare `node` from settings.json), so the
// spec imports its pure seams directly — same pattern as the #824 sibling
// (completion-report-gate.spec.ts).
import {
  JARGON_TOKENS,
  calibrationMessage,
  collectCopy,
  evaluateAskUserQuestion,
  jargonHitsIn,
} from "../../hooks/askuserquestion-calibration-guard.mjs";

/**
 * Cover for the #940 AskUserQuestion calibration gate (PreToolUse hook): every
 * well-formed `AskUserQuestion` call gets a NON-BLOCKING calibration reminder
 * (product taste/scope = owner; engineering/architecture/impl-mechanism/
 * token-scope/accuracy-vs-cost = lead's own call), and owner-facing option copy
 * carrying undefined internal jargon (SHA / SSH / worktree / …) gets an
 * appended WARN naming the tokens. The hook NEVER blocks (exit 0 +
 * permissionDecision "allow"); a malformed input fails open to the reminder.
 */

const HOOK = fileURLToPath(
  new URL("../../hooks/askuserquestion-calibration-guard.mjs", import.meta.url),
);

function runHook(payload: unknown) {
  return spawnSync(process.execPath, [HOOK], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
  });
}

const preToolUsePayload = (toolInput: unknown) => ({
  session_id: "s-940",
  cwd: "C:/repo",
  hook_event_name: "PreToolUse",
  tool_name: "AskUserQuestion",
  tool_input: toolInput,
});

// A clean PRODUCT-scope question — legitimate owner pick, zero jargon.
const CLEAN_PRODUCT_INPUT = {
  questions: [
    {
      question: "Какой акцентный цвет для карточки вебинара?",
      header: "Цвет акцента",
      options: [
        { label: "Синий бренд", description: "Основной цвет, спокойнее" },
        { label: "Тёплый корал", description: "Ярче, привлекает внимание" },
      ],
    },
  ],
};

// An option-copy set that leaks internal jargon into owner-facing text.
const JARGON_INPUT = {
  questions: [
    {
      question: "How should we record the deploy?",
      header: "Deploy record",
      options: [
        { label: "Tag the SHA", description: "Pin the deployed SHA via SSH" },
        { label: "Manual note", description: "A plain changelog line" },
      ],
    },
  ],
};

describe("askuserquestion-calibration-guard hook (spawned end-to-end)", () => {
  it("emits the calibration reminder (exit 0, allow) on a clean product question", () => {
    const r = runHook(preToolUsePayload(CLEAN_PRODUCT_INPUT));
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.systemMessage).toContain("AskUserQuestion calibration (#940)");
    expect(out.systemMessage).toContain("LEAD's OWN call");
    expect(out.systemMessage).not.toContain("jargon lint");
    expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
  });

  it("appends a jargon WARN naming the tokens when option copy leaks jargon (SHA/SSH)", () => {
    const r = runHook(preToolUsePayload(JARGON_INPUT));
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.systemMessage).toContain("jargon lint (#940)");
    expect(out.systemMessage).toContain("SHA");
    expect(out.systemMessage).toContain("SSH");
    expect(out.systemMessage).toContain("must read, not decode");
    expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("never blocks — always exits 0, even on malformed / empty tool_input", () => {
    expect(runHook(preToolUsePayload({})).status).toBe(0);
    expect(runHook(preToolUsePayload({ questions: "oops" })).status).toBe(0);
    expect(runHook(preToolUsePayload(null)).status).toBe(0);
  });

  it("fails open (exit 0, no output) on garbage stdin", () => {
    const r = runHook("not-json{{{");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});

describe("evaluateAskUserQuestion() (pure seam)", () => {
  it("always returns the calibration message with zero hits on clean copy", () => {
    const { systemMessage, jargonHits } =
      evaluateAskUserQuestion(CLEAN_PRODUCT_INPUT);
    expect(systemMessage).toBe(calibrationMessage());
    expect(jargonHits).toEqual([]);
  });

  it("collects sorted, de-duplicated jargon hits and appends the WARN line", () => {
    const { systemMessage, jargonHits } = evaluateAskUserQuestion(JARGON_INPUT);
    expect(jargonHits).toEqual(["SHA", "SSH"]);
    expect(systemMessage).toContain("SHA, SSH");
  });

  it("still returns the reminder (no throw) on empty / malformed input", () => {
    expect(evaluateAskUserQuestion({}).systemMessage).toBe(calibrationMessage());
    expect(evaluateAskUserQuestion({}).jargonHits).toEqual([]);
    expect(evaluateAskUserQuestion(null).jargonHits).toEqual([]);
    expect(evaluateAskUserQuestion({ questions: "x" }).jargonHits).toEqual([]);
    expect(evaluateAskUserQuestion(undefined).systemMessage).toBe(
      calibrationMessage(),
    );
  });
});

describe("jargonHitsIn() (whole-token, case-sensitive)", () => {
  it("matches seeded tokens as whole tokens", () => {
    expect(jargonHitsIn("Pin the deployed SHA")).toEqual(["SHA"]);
    expect(jargonHitsIn("connect over SSH first")).toEqual(["SSH"]);
    expect(jargonHitsIn("isolate in a worktree")).toEqual(["worktree"]);
    expect(jargonHitsIn("run Mode-a review then merge:gate")).toEqual([
      "Mode-a",
      "merge:gate",
    ]);
  });

  it("does NOT match a jargon token embedded in a larger word", () => {
    expect(jargonHitsIn("the system SHALL reject")).toEqual([]); // SHA in SHALL
    expect(jargonHitsIn("a SSHD daemon")).toEqual([]); // SSH in SSHD
  });

  it("is case-sensitive (owner prose 'sha256sum' is not the token)", () => {
    expect(jargonHitsIn("a sha of the commit")).toEqual([]);
  });

  it("returns [] for empty / non-string input without throwing", () => {
    expect(jargonHitsIn("")).toEqual([]);
    expect(jargonHitsIn(null)).toEqual([]);
    expect(jargonHitsIn(undefined)).toEqual([]);
  });
});

describe("collectCopy() (shape-tolerant flatten)", () => {
  it("gathers question + header + every option label/description", () => {
    expect(collectCopy(CLEAN_PRODUCT_INPUT)).toEqual([
      "Какой акцентный цвет для карточки вебинара?",
      "Цвет акцента",
      "Синий бренд",
      "Основной цвет, спокойнее",
      "Тёплый корал",
      "Ярче, привлекает внимание",
    ]);
  });

  it("skips missing / non-string / malformed fields, never throws", () => {
    expect(collectCopy({})).toEqual([]);
    expect(collectCopy(null)).toEqual([]);
    expect(collectCopy({ questions: "x" })).toEqual([]);
    expect(
      collectCopy({ questions: [{ question: "q", options: "bad" }, null, 7] }),
    ).toEqual(["q"]);
  });
});

describe("JARGON_TOKENS seed list", () => {
  it("carries the Issue #940 seed tokens", () => {
    for (const t of ["SHA", "SSH", "container-tag"]) {
      expect(JARGON_TOKENS).toContain(t);
    }
  });
});

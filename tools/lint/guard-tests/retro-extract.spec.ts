import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Pure helpers exported from the retro extractor (#360). Importing them does NOT
// fire the script's `main()` — it is guarded behind an entry-point check, the
// same idiom as agent-bootstrap.ts.
import {
  auqUserStrings,
  CORRECTION_RE,
  isAuqAnswer,
} from "../../retro/extract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTRACT = resolve(HERE, "..", "..", "retro", "extract.mjs");
const FIXTURE_DIR = resolve(HERE, "fixtures", "retro");
const FIXTURE_ID = "auq-correction-session";

/**
 * #360 — the decisive correction of a collision/decision session often arrives
 * as the free-text answer (or the note attached to a selection) of an
 * `AskUserQuestion`, which lives in a `tool_result` envelope the typed-message
 * path skips. The extractor must scan those user-authored strings — never the
 * question text, which is the assistant's — so a session whose only correction
 * is an AUQ answer is no longer mislabelled `corrections: 0` (the #345 miss).
 */

// ── pure-logic unit cover ───────────────────────────────────────────────────
describe("retro extract — AUQ answer detection (pure)", () => {
  const structured = {
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          content:
            'Your questions have been answered: "Включаем MFA?"="Да" You can now continue with these answers in mind.',
        },
      ],
    },
    toolUseResult: {
      answers: { "Включаем MFA?": "Да" },
      annotations: { "Включаем MFA?": { notes: "по спеке guest без MFA, исключим" } },
    },
  };

  const typed = {
    type: "user",
    message: { role: "user", content: "обычное сообщение" },
  };

  it("isAuqAnswer: true for an AUQ tool_result entry, false for a typed turn", () => {
    expect(isAuqAnswer(structured)).toBe(true);
    expect(isAuqAnswer(typed)).toBe(false);
  });

  it("auqUserStrings: returns answer values + annotation notes, NOT the question", () => {
    const strings = auqUserStrings(structured);
    expect(strings).toContain("Да");
    expect(strings).toContain("по спеке guest без MFA, исключим");
    // the question text is the assistant's — it must never be returned
    expect(strings.some((s) => s.includes("Включаем MFA?"))).toBe(false);
  });

  it("auqUserStrings: falls back to the content-string envelope when structured payload is absent", () => {
    const fallbackOnly = {
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            content:
              'Your questions have been answered: "Продолжаем?"="нет, я просил другое" You can now continue with these answers in mind.',
          },
        ],
      },
    };
    const strings = auqUserStrings(fallbackOnly);
    expect(strings).toEqual(["нет, я просил другое"]);
    // never the question (the LHS of the "..."="..." envelope)
    expect(strings.some((s) => s.includes("Продолжаем?"))).toBe(false);
  });

  it("CORRECTION_RE flags an AUQ free-text correction, not a benign preset", () => {
    expect(CORRECTION_RE.test("почему ты не создал своё рабочее дерево?")).toBe(true);
    expect(CORRECTION_RE.test("Вариант A")).toBe(false);
  });
});

// ── end-to-end over a committed fixture log ─────────────────────────────────
describe("retro extract — AUQ corrections end-to-end", () => {
  function run() {
    const out = mkdtempSync(join(tmpdir(), "retro-auq-"));
    const res = spawnSync(
      "node",
      [EXTRACT, "--log-dir", FIXTURE_DIR, "--session", FIXTURE_ID, "--out-dir", out],
      { encoding: "utf8" },
    );
    expect(res.status, res.stderr).toBe(0);
    const summary = JSON.parse(readFileSync(join(out, "summary.json"), "utf8"));
    const corrections = JSON.parse(readFileSync(join(out, "corrections.json"), "utf8"));
    const texts = corrections.flatMap((s: { messages: { text: string }[] }) =>
      s.messages.map((m) => m.text),
    );
    return { summary, texts };
  }

  it("flags the AUQ answer-value, the annotation note, and the content-string fallback", () => {
    const { summary, texts } = run();
    // typed correction (entry 3) + AUQ value (4) + AUQ note (5) + fallback (8)
    expect(summary.totalCorrectionFlagged).toBe(4);
    expect(texts).toContain("почему ты не создал своё рабочее дерево?");
    expect(texts).toContain(
      "это неправильно — guest по нашей спеке без MFA, исключаем из скоупа",
    );
    expect(texts).toContain("нет, я просил другое");
  });

  it("does not regress typed-turn detection or handoff exclusion", () => {
    const { texts } = run();
    // typed correction still flagged
    expect(texts).toContain("стоп, это неправильно, верни как было");
    // handoff continuation never counts as a correction
    expect(texts.some((t: string) => t.includes("# Agent bootstrap"))).toBe(false);
  });

  it("never flags a benign preset answer or scans the question text", () => {
    const { texts } = run();
    expect(texts).not.toContain("Вариант A");
    expect(texts).not.toContain("Да, чини");
    // a correction word in the QUESTION must not leak in via the answer path
    expect(texts.some((t: string) => t.includes("Почему упал тест"))).toBe(false);
  });
});

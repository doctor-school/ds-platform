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
// SELF_CATCH is the assistant-side self-correction lexicon; #362 made it
// exportable behind the same entry-point guard so it is unit testable.
import { SELF_CATCH } from "../../retro/transcripts.mjs";

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

// ── CORRECTION_RE lexicon recall (#362) ─────────────────────────────────────
// A genuine correction that uses none of the ORIGINAL tokens was missed even on
// the right channel — the canonical live-corpus example surfaced in the #360
// review («…не нужен MFA, давай тогда его вообще сейчас исключим из скоупа»).
// The lexicon now also covers `не нужен/на`, `исключ`, `вместо`, `на самом деле`,
// `всё-таки`, `ещё раз`, `не должно` — chosen because each catches real pushback
// in the corpus with no benign false positives. The soft-directive «давай …»
// framing is deliberately NOT a token (it is mostly a benign next-step directive,
// «давай дальше / делай /wrap»); the corrective companion words carry the signal.
describe("retro extract — CORRECTION_RE lexicon recall (#362)", () => {
  it("flags real-shape corrections that use none of the original tokens", () => {
    // the canonical live-corpus miss («не нужен» + «исключ»)
    expect(
      CORRECTION_RE.test(
        "по нашей же спеке для doctor_guest не нужен MFA, давай тогда его вообще сейчас исключим из скоупа",
      ),
    ).toBe(true);
    // replacement instruction («вместо») — no original token present
    expect(
      CORRECTION_RE.test("не заводи новый сервис, переиспользуй существующий вместо нового"),
    ).toBe(true);
    // pushback marker «всё-таки» riding a soft directive
    expect(
      CORRECTION_RE.test("Давай всё-таки превью в HTML формате делать, это логичнее"),
    ).toBe(true);
    // redo / re-explain marker «ещё раз»
    expect(CORRECTION_RE.test("Нет, давай ещё раз — что значит этот шаг?")).toBe(true);
    // «на самом деле» — the classic "actually…" reframe
    expect(CORRECTION_RE.test("на самом деле это совсем не то, что я просил")).toBe(true);
    // bug-complaint «не должно» (the throttle report; «должно быть» alone missed it)
    expect(CORRECTION_RE.test("троттл слишком агрессивный, так быть не должно")).toBe(true);
  });

  it("precision guard: benign soft-directives and presets stay unflagged", () => {
    // bare «давай …» next-step directives must NOT start matching
    expect(CORRECTION_RE.test("ок, давай дальше по плану")).toBe(false);
    expect(CORRECTION_RE.test("Давай сначала follow-up, потом 003")).toBe(false);
    expect(CORRECTION_RE.test("Давай прогоним /wrap")).toBe(false);
    expect(CORRECTION_RE.test("Давай разберёмся с 313")).toBe(false);
    // preset selections / neutral acks
    expect(CORRECTION_RE.test("Вариант A")).toBe(false);
    expect(CORRECTION_RE.test("ок, дальше")).toBe(false);
    // «лучше» was deliberately LEFT OUT — as praise it is benign, so it must
    // not flag (the one real «лучше» correction is already caught by «не нужен»)
    expect(CORRECTION_RE.test("так стало гораздо лучше, спасибо")).toBe(false);
  });

  it("precision guard: «исключ» is stem-anchored — benign exception/exclusively talk stays unflagged", () => {
    // the corrective verb forms still flag
    expect(CORRECTION_RE.test("давай исключим это из скоупа")).toBe(true);
    expect(CORRECTION_RE.test("надо исключить шаг")).toBe(true);
    expect(CORRECTION_RE.test("исключаем фичу из релиза")).toBe(true);
    // but routine technical talk must NOT (the #362-review precision boundary)
    expect(CORRECTION_RE.test("это исключение бросается в обработчике")).toBe(false);
    expect(CORRECTION_RE.test("работает исключительно на проде")).toBe(false);
  });
});

// ── SELF_CATCH lexicon recall (#362) ────────────────────────────────────────
// The assistant-side self-correction lexicon missed clean RU markers the corpus
// surfaced («я зря …», «я перепутал …»). The additions are high-precision: the
// noisy candidates («исправл», «пропустил», «нарушил») were rejected because they
// flood on neutral status lines and quoted-rule narration.
describe("retro transcripts — SELF_CATCH lexicon recall (#362)", () => {
  it("flags clean RU self-correction markers the corpus showed missed", () => {
    expect(SELF_CATCH.test("я зря впихнул «покой» и «ошибку» в две узкие колонки")).toBe(true);
    expect(SELF_CATCH.test("да, теперь вижу — я зря запустил опрос с нуля")).toBe(true);
    expect(SELF_CATCH.test("я перепутал отправителя и получателя")).toBe(true);
    expect(SELF_CATCH.test("я неправильно понял требование")).toBe(true);
  });

  it("still flags the original markers and stays quiet on neutral status lines", () => {
    expect(SELF_CATCH.test("на самом деле порядок @Inject важен")).toBe(true);
    expect(SELF_CATCH.test("я ошибся в импорте")).toBe(true);
    // a neutral status line must NOT read as a self-catch (the reason «исправл»
    // / «пропустил» were deliberately left out of the lexicon)
    expect(SELF_CATCH.test("CI зелёный, исправил тип в api-client, мержу")).toBe(false);
    expect(SELF_CATCH.test("локальный cleanup gh пропустил из-за worktree")).toBe(false);
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

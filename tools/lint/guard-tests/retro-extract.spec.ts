import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  isHandoff,
  queuedCommandPrompt,
  queuedContrastiveRedirect,
  readSessionSegments,
  resolveSessionSegments,
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

// ── queued_command interjection detection (pure) ────────────────────────────
// A mid-stream owner interjection queued while the agent is busy is journaled as
// a standalone `attachment`/`queued_command` entry (no `message`, type !==
// 'user'), which the typed-message path skips — so a correction queued this way
// was reported as 0. Only the `commandMode: 'prompt'` variant is real human
// input; `commandMode: 'task-notification'` is a system/background wrapper and
// must never be read as owner text.
describe("retro extract — queued_command interjection detection (pure)", () => {
  it("returns the prompt for a real `commandMode: 'prompt'` interjection", () => {
    expect(
      queuedCommandPrompt({
        type: "attachment",
        attachment: {
          type: "queued_command",
          prompt: "стоп, опять не то — верни как было",
          commandMode: "prompt",
        },
      }),
    ).toBe("стоп, опять не то — верни как было");
  });

  it("returns null for a `task-notification` wrapper and for a non-queued entry", () => {
    expect(
      queuedCommandPrompt({
        type: "attachment",
        attachment: {
          type: "queued_command",
          prompt: "<task-notification>…почему…</task-notification>",
          commandMode: "task-notification",
        },
      }),
    ).toBeNull();
    expect(
      queuedCommandPrompt({ type: "user", message: { role: "user", content: "hi" } }),
    ).toBeNull();
  });
});

// ── queued_command contrastive-redirect detection (#706) ────────────────────
// The 2026-07-10 session f73a5301 queued a genuine owner pushback —
// «Но агент ещё работает» — as a mid-stream interjection carrying NONE of the
// CORRECTION_RE tokens, so it scored 0. A bare «но»/«but» is far too frequent
// for the GLOBAL lexicon, so a start-anchored contrastive-opener heuristic is
// applied ONLY inside the queued_command branch (rare interjections), keeping
// the typed/AUQ paths byte-identical.
describe("retro extract — queued_command contrastive-redirect detection (#706)", () => {
  it("flags a start-anchored contrastive-opener redirect", () => {
    // the f73a5301 miss
    expect(queuedContrastiveRedirect("Но агент ещё работает")).toBe(true);
    // adjacent RU/EN contrastive openers
    expect(queuedContrastiveRedirect("Однако ты забыл прогнать гарды")).toBe(true);
    expect(queuedContrastiveRedirect("But you already merged that")).toBe(true);
    expect(queuedContrastiveRedirect("Actually that's the wrong branch")).toBe(true);
    // leading whitespace is tolerated (trimStart)
    expect(queuedContrastiveRedirect("  Но это не то")).toBe(true);
  });

  it("precision guard: a mid-sentence «но» / non-opener never fires", () => {
    // «но» only mid-sentence — not a contrastive opener
    expect(queuedContrastiveRedirect("Всё но потом")).toBe(false);
    expect(queuedContrastiveRedirect("сделай это, но аккуратно")).toBe(false);
    // «но» as the start of a longer word must not trip the Cyrillic anchor
    expect(queuedContrastiveRedirect("Ноутбук перезагрузи")).toBe(false);
    // the bare «А …» opener is deliberately out of scope (benign next-step)
    expect(queuedContrastiveRedirect("А давай дальше по плану")).toBe(false);
  });

  it("does NOT change the global CORRECTION_RE — a typed «Но …» stays unflagged", () => {
    // the heuristic is queued-scoped; the typed/AUQ lexicon is unchanged, so a
    // benign typed «Но …» opener with no correction token stays quiet
    expect(CORRECTION_RE.test("Но ладно, продолжай")).toBe(false);
  });
});

// ── worktree-reslug segment resolution (#800) ───────────────────────────────
// A session that calls EnterWorktree re-slugs its log dir — segments move from
// ~/.claude/projects/<slug>/ to <slug>--claude-worktrees-<N>/ — so a single-dir
// `--session` lookup finds nothing. resolveSessionSegments globs EVERY sibling
// slug dir containing the main slug, and readSessionSegments merges the found
// segments into one chronological stream (oldest-first) so the split session is
// processed as ONE session, not N partial ones.
describe("retro extract — worktree-reslug segment resolution (#800)", () => {
  it("finds a session's segments across the main + worktree slug dirs and merges oldest-first", () => {
    const projects = mkdtempSync(join(tmpdir(), "retro-projects-"));
    const slug = "C--Users-x-repos-ds-platform";
    const id = "abc-123-def";
    mkdirSync(join(projects, slug));
    mkdirSync(join(projects, `${slug}--claude-worktrees-9`));
    // main-dir segment carries the OLDER message
    writeFileSync(
      join(projects, slug, `${id}.jsonl`),
      JSON.stringify({
        type: "user",
        timestamp: "2026-01-01T00:00:00.000Z",
        message: { role: "user", content: "first, in the main dir" },
      }) + "\n",
    );
    // worktree re-slug segment carries the NEWER message
    writeFileSync(
      join(projects, `${slug}--claude-worktrees-9`, `${id}.jsonl`),
      JSON.stringify({
        type: "user",
        timestamp: "2026-01-02T00:00:00.000Z",
        message: { role: "user", content: "second, after EnterWorktree" },
      }) + "\n",
    );

    const segs = resolveSessionSegments(projects, slug, id);
    expect(segs).toHaveLength(2);

    const parsed = readSessionSegments(segs)
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    expect(parsed.map((m) => m.timestamp)).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
    ]);
  });

  it("normalizes a worktree slug to the main slug so it still matches the main dir", () => {
    const projects = mkdtempSync(join(tmpdir(), "retro-projects-"));
    const slug = "C--Users-x-repos-ds-platform";
    const id = "sess-1";
    mkdirSync(join(projects, slug));
    writeFileSync(join(projects, slug, `${id}.jsonl`), "{}\n");
    // passing the WORKTREE slug (REPO_ROOT slugged from inside a worktree) still
    // resolves to the main dir segment
    const segs = resolveSessionSegments(projects, `${slug}--claude-worktrees-706`, id);
    expect(segs).toHaveLength(1);
  });

  it("returns [] when the projects dir is absent (no crash)", () => {
    expect(resolveSessionSegments(join(tmpdir(), "does-not-exist-xyz"), "slug", "id")).toEqual([]);
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

// ── CORRECTION_RE — RU delivery-refutation + false-premise recall (#492) ─────
// The single-session /wrap retro of session a5676594 (2026-07-04) scored 0
// corrections on a session with two explicit owner corrections: a false-premise
// challenge («С чего ты взял, что есть?») and a delivery-failure report refuting
// a claimed DoD («в it@bbm.academy пусто»). Single-session mode survived because
// the retro agent reads the full transcript; in MULTI-session batch mode these
// RU corrections drop silently out of the corpus. The lexicon now covers the
// false-premise idiom, the negated-delivery family (не дошл / не пришл /
// не получил), and the empty-inbox predicate «пуст(о|ой|ая|ые|ых)» — the last
// left+right anchored so it never fires mid-word on упустили / запустил /
// допустим (the four real corpus noise cases the bare пуст-stem caught).
describe("retro extract — CORRECTION_RE RU delivery-refutation recall (#492)", () => {
  it("flags the false-premise challenge and the empty-inbox delivery report", () => {
    // the two live-corpus misses from session a5676594
    expect(CORRECTION_RE.test("С чего ты взял, что есть? Поставь it@bbm.academy пока")).toBe(true);
    expect(CORRECTION_RE.test("На a@ получил три письма, в it@bbm.academy пусто")).toBe(true);
    // adjacent real delivery-failure report already in the corpus
    expect(CORRECTION_RE.test("[Image #1] Malpit пустой [Image #2]")).toBe(true);
    // didn't-receive report (the corpus «Код отправил, но SMS не получил»)
    expect(CORRECTION_RE.test("Код отправил, но SMS не получил")).toBe(true);
    // forward-looking negated-delivery idioms (multi-session email verification)
    expect(CORRECTION_RE.test("письмо так и не дошло")).toBe(true);
    expect(CORRECTION_RE.test("код на телефон так и не пришёл")).toBe(true);
  });

  it("precision guard: «пуст» is Cyrillic-anchored — mid-word matches stay unflagged", () => {
    // the four real corpus noise cases the bare пуст-stem would have caught
    expect(CORRECTION_RE.test("Мы ничего не упустили?")).toBe(false);
    expect(CORRECTION_RE.test("Сервер выключился. Сейчас запустил его")).toBe(false);
    expect(CORRECTION_RE.test("допустим origin для одного, intent для другого")).toBe(false);
    // narrow suffix group: instrumental/genitive data-structure talk stays quiet
    expect(CORRECTION_RE.test("оставь поле пустым")).toBe(false);
    expect(CORRECTION_RE.test("пустого объекта тут нет")).toBe(false);
    // a benign receipt ack must not flag via «не получил» (no «не» before it)
    expect(CORRECTION_RE.test("Да, получил")).toBe(false);
  });
});

// ── CORRECTION_RE — RU «не X, а Y» contrastive-substitution recall (#508) ────
// The single-session /wrap retro of session 548dd102 (2026-07-05) scored 0 on the
// DEFINING owner correction — «Не Cancelled, а done как фактически сделанные…» —
// the direct «не X, а Y» contrastive substitution (replace X with Y), which used
// none of the prior tokens. Added «не WORD, а » anchored to a SINGLE token between
// «не» and «, а » (the token class forbids space + comma), so the benign additive
// «не только X, а также Y» (two tokens before the comma) stays unflagged.
describe("retro extract — CORRECTION_RE «не X, а Y» contrastive recall (#508)", () => {
  it("flags the contrastive-substitution correction", () => {
    // the live-corpus miss from session 548dd102
    expect(CORRECTION_RE.test("Не Cancelled, а done как фактически сделанные")).toBe(true);
    expect(CORRECTION_RE.test("не так, а вот так надо было")).toBe(true);
    expect(CORRECTION_RE.test("закрывай не сейчас, а после ревью")).toBe(true);
  });

  it("precision guard: the benign additive «не только X, а также Y» stays unflagged", () => {
    // single-token constraint before «, а» keeps the additive «не только …» out
    expect(CORRECTION_RE.test("поддержим не только email, а также телефон")).toBe(false);
    // a multi-word left side is out of scope and must not match the additive shape
    expect(CORRECTION_RE.test("не A и B, а также C")).toBe(false);
  });
});

// ── CORRECTION_RE — RU interrogative / reproach recall (#609) ────────────────
// The /wrap retro of session 35991795 scored 0 on TWO genuine owner corrections,
// both phrased as interrogative reproaches — a common RU register the lexicon
// could not see: «Сколько он должен идти по времени? Уже 20 минут» (a duration
// reproach: how long is this STILL running) and «…гард жизненного цикла — чего?
// …Я вроде просил…» (a "but I thought I asked …" reproach). Added, each anchored
// on a reproach marker so plain information questions stay unflagged: the
// «сколько … уже …» duration form (both «сколько» and «уже» Cyrillic-anchored so
// «несколько … уже» / «хуже» never fire), the «(я) вроде прос/говор/договор…»
// broken-agreement form, and the English «didn't I ask» reproach. Bare «почему»
// / «чего?» are deliberately NOT new tokens — «почему» already flags and a bare
// interrogative floods on benign info questions.
describe("retro extract — CORRECTION_RE RU interrogative reproach recall (#609)", () => {
  it("flags the two session-35991795 interrogative-reproach misses", () => {
    // duration reproach — «сколько … уже …»
    expect(CORRECTION_RE.test("Сколько он должен идти по времени? Уже 20 минут")).toBe(true);
    // broken-agreement reproach — «Я вроде просил …»
    expect(
      CORRECTION_RE.test("…гард жизненного цикла — чего?…Я вроде просил…"),
    ).toBe(true);
  });

  it("flags adjacent interrogative-reproach shapes", () => {
    expect(CORRECTION_RE.test("сколько это уже длится?")).toBe(true);
    expect(CORRECTION_RE.test("я вроде говорил не трогать этот файл")).toBe(true);
    expect(CORRECTION_RE.test("мы вроде договорились на другом варианте")).toBe(true);
    expect(CORRECTION_RE.test("didn't I ask you to stop?")).toBe(true);
  });

  it("precision guard: plain information questions stay unflagged", () => {
    // a plain quantity question — no «уже» reproach marker
    expect(CORRECTION_RE.test("сколько это будет стоить?")).toBe(false);
    // «несколько … уже» must not fire (сколько is left-anchored)
    expect(CORRECTION_RE.test("несколько задач уже готовы")).toBe(false);
    // «хуже» must not fire the «уже» anchor
    expect(CORRECTION_RE.test("стало хуже после сколь-нибудь заметной паузы")).toBe(false);
    // benign «вроде» ack with no request/agreement verb
    expect(CORRECTION_RE.test("вроде всё работает, спасибо")).toBe(false);
    expect(CORRECTION_RE.test("да, вроде так и есть")).toBe(false);
  });
});

// ── CORRECTION_RE — RU hedged / question-form recall (#829) ──────────────────
// The wrap retro of session edf902e9 scored 0 on the #818 DEFINING owner
// correction — «Кажется hover стейты элементов не соответствуют нашей
// дизайн-системе. Всё прошло гарды?» — a hedged observation-form correction
// (softened «кажется» + the mismatch predicate «не соответству…»). A recurrence
// (2026-07-13, session 85170286) added the duration-reproach register: «CI до
// сих пор идёт? Не долго ли?». Added: «кажется», «не соответству», the bare
// «вроде же» (the verb-anchored «вроде + прос/…» form misses the verbless
// shape), «до сих пор» anchored to a verb-of-progress (ид/работ/вис/не), and
// the explicit too-long interrogatives «не долго ли» / «не слишком ли долго».
// The Issue's «почему (не|это)» / «разве не» forms are already subsumed by the
// bare «почему» / «разве» tokens.
describe("retro extract — CORRECTION_RE hedged/question-form recall (#829)", () => {
  it("flags the #818 hedged design-mismatch correction (session edf902e9)", () => {
    expect(
      CORRECTION_RE.test(
        "Кажется hover стейты элементов не соответствуют нашей дизайн-системе. Всё прошло гарды?",
      ),
    ).toBe(true);
  });

  it("flags the session-85170286 duration reproach", () => {
    expect(CORRECTION_RE.test("CI до сих пор идёт? Не долго ли?")).toBe(true);
  });

  it("flags adjacent hedged / duration-reproach shapes", () => {
    // hedged suspected-defect opener
    expect(CORRECTION_RE.test("кажется ты сломал сборку этим коммитом")).toBe(true);
    // explicit spec-mismatch report
    expect(CORRECTION_RE.test("это не соответствует спеке 003")).toBe(true);
    // verbless hedged broken-expectation
    expect(CORRECTION_RE.test("вроде же было по-другому в прошлый раз")).toBe(true);
    // duration reproach on the other progress stems
    expect(CORRECTION_RE.test("деплой до сих пор висит")).toBe(true);
    expect(CORRECTION_RE.test("сборка до сих пор не прошла")).toBe(true);
    // the question-form Issue examples ride the existing bare tokens
    expect(CORRECTION_RE.test("почему это оказалось в PR?")).toBe(true);
    expect(CORRECTION_RE.test("разве не должно быть наоборот?")).toBe(true);
  });

  it("precision guard: benign narration stays unflagged", () => {
    // «до сих пор» + a non-progress word — historical narration, not reproach
    expect(CORRECTION_RE.test("до сих пор так и осталось со времён MVP")).toBe(false);
    // benign hedged ack without «же» or a request verb (pre-existing guard shape)
    expect(CORRECTION_RE.test("вроде всё работает, спасибо")).toBe(false);
    // a plain «долго» estimate is not the «не долго ли» reproach
    expect(CORRECTION_RE.test("сборка обычно долго собирается, минут пять")).toBe(false);
  });
});

// ── isHandoff FIRST ACTION-opener recall (#889) ─────────────────────────────
// This repo's canonical handoff (run-wrap stage-5 override) opens with the
// literal `FIRST ACTION: pipe this verbatim block through `pnpm handoff:verify``
// and carries the structural markers `Do next (wave …)` and/or `Next task:` —
// none of which the original detector (`You are continuing` / `# Agent
// bootstrap` / `Current task`) recognized, so a pasted handoff was miscounted as
// an owner correction (its body trips CORRECTION_RE tokens). A handoff is never
// a correction (run-session-retro §3): widening isHandoff is the fix point.
describe("retro extract — isHandoff FIRST ACTION-opener recall (#889)", () => {
  const handoff = [
    "FIRST ACTION: pipe this verbatim block through `pnpm handoff:verify`",
    "",
    "You are resuming work on the retro tooling.",
    "Do next (wave 3): widen the isHandoff detector, then open the PR.",
    "Почему это важно: недосчёт корректировок искажает ретро.",
  ].join("\n");

  it("classifies a FIRST ACTION-opener handoff as handoff, not a correction", () => {
    expect(isHandoff(handoff)).toBe(true);
    // a handoff is excluded from the correction count even though its body
    // contains correction tokens («почему») — mirrors the extractor's
    // `!handoff && CORRECTION_RE.test(text)` classification.
    expect(!isHandoff(handoff) && CORRECTION_RE.test(handoff)).toBe(false);
  });

  it("recognizes the corroborating structural markers", () => {
    expect(isHandoff("Do next (wave 2): ship the guard-test extension")).toBe(true);
    expect(isHandoff("Next task: rebase onto origin/main and re-run CI")).toBe(true);
  });

  it("keeps the three original matchers intact", () => {
    expect(isHandoff("You are continuing a previous session")).toBe(true);
    expect(isHandoff("# Agent bootstrap\n## Current task\nDo the thing")).toBe(true);
    expect(isHandoff("## Current task\nresume #889")).toBe(true);
  });

  it("does not over-broaden — a genuine owner correction is still a correction", () => {
    const correction = "Почему ты не расширил детектор? Это неправильно, верни как было";
    expect(isHandoff(correction)).toBe(false);
    expect(!isHandoff(correction) && CORRECTION_RE.test(correction)).toBe(true);
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

  it("flags the AUQ answer-value, the annotation note, the content-string fallback, and the queued_command interjection", () => {
    const { summary, texts } = run();
    // typed correction (entry 3) + AUQ value (4) + AUQ note (5) + fallback (8) +
    // the mid-stream queued_command prompt interjection (9)
    expect(summary.totalCorrectionFlagged).toBe(5);
    expect(texts).toContain("почему ты не создал своё рабочее дерево?");
    expect(texts).toContain(
      "это неправильно — guest по нашей спеке без MFA, исключаем из скоупа",
    );
    expect(texts).toContain("нет, я просил другое");
    // the queued mid-stream owner interjection is now counted…
    expect(texts).toContain("стоп, опять не то — верни как было в прошлый раз");
    // …but a `task-notification` queued_command (entry 10) is a system wrapper,
    // never owner text — its «почему-то» must not leak in as a correction.
    expect(texts.some((t: string) => t.includes("Background command"))).toBe(false);
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

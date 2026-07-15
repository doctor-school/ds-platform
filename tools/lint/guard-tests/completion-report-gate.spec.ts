import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// The hook is plain ESM JS (runs under bare `node` from settings.json), so the
// spec imports its pure seams directly — same pattern as the #823 sibling.
import {
  REPORT_MARKER,
  decideBlock,
  extractLastAssistantText,
  isCompletionReport,
  isDecisionRequest,
  isInterimStatus,
  isProposalOrInFlight,
} from "../../hooks/completion-report-gate.mjs";

/**
 * Cover for the #824 completion-report gate (Stop hook): a final assistant
 * message that reads as a task-completion report (completion verbs + PR/Issue
 * refs) but lacks the «📈 % от запланированного» marker blocks the stop
 * (exit 2 + corrective stderr naming skill `report-task-outcome`); everything
 * else — non-completion turns, marker present, `stop_hook_active`, unreadable
 * transcript — allows the stop (exit 0, fail-open).
 *
 * Fixture transcripts are written into an `os.tmpdir()` temp dir at test time
 * and every path is built via `path.join` — no drive-letter literals, so the
 * spec runs identically on Windows and the Linux CI runner (PR #832 lesson).
 */

const HOOK = fileURLToPath(
  new URL("../../hooks/completion-report-gate.mjs", import.meta.url),
);

const DIR = mkdtempSync(join(tmpdir(), "completion-report-gate-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

let fixtureN = 0;
/** Write a JSONL transcript ending in one assistant text message. */
function transcriptWith(lastAssistantText: string): string {
  const p = join(DIR, `transcript-${fixtureN++}.jsonl`);
  const lines = [
    JSON.stringify({
      type: "user",
      message: { role: "user", content: "продолжай" },
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        id: "msg_final",
        role: "assistant",
        content: [{ type: "text", text: lastAssistantText }],
      },
    }),
  ];
  writeFileSync(p, lines.join("\n") + "\n", "utf8");
  return p;
}

function runHook(payload: unknown) {
  return spawnSync(process.execPath, [HOOK], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
  });
}

const stopPayload = (transcriptPath: string, stopHookActive = false) => ({
  session_id: "s-824",
  transcript_path: transcriptPath,
  hook_event_name: "Stop",
  stop_hook_active: stopHookActive,
});

const COMPLETION_NO_MARKER =
  "Готово: PR #810 смержен (squash), Issue #806 закрыта, CI зелёный. " +
  "Ветка удалена, board Status = Done.";
const COMPLETION_WITH_MARKER =
  COMPLETION_NO_MARKER + "\n\n📈 % от запланированного: 100% — весь скоуп.";

// The observed 2026-07-13 live false positive (#839): a /wrap stage-2
// APPROVAL-REQUEST turn — completion verbs («смержен») + Issue refs are
// present, but the turn asks the owner a decision question instead of
// reporting completion. The gate must stay silent on it.
const LIVE_FP_STAGE2 =
  "/wrap стадия 2 — предложения по ретро сессии 9d41016b:\n\n" +
  "1. F1: фикс уже применён (commit df684b2), отдельная Issue не требуется.\n" +
  "2. F2: PR #838 смержен ранее, но handoff-verify хук ещё не смержен — " +
  "предлагаю Issue «tooling(hooks): напоминание pnpm handoff:verify».\n\n" +
  "⏸ ЖДУ ВАС: одобряете открытие Issue по пункту F2 — да/нет?";

// #855 / 2026-07-13: a mid-wave dispatch checkpoint. It carries completion
// verbs («смержен») + a ref, but reports an in-flight sub-step («жду CI»,
// «пока ничего не финализировано»), not a terminal completion report. Before
// the #855 interim-status recognizer these tripped the gate and blocked.
const INTERIM_CHECKPOINT_ALIVE =
  "Checkpoint пройден: #828 — ALIVE, коммиты идут. Жду вердикт ревьюера.";
const INTERIM_CHECKPOINT_SUBSTEP =
  "Checkpoint: #828 смержен в ветку, жду CI. Пока ничего не финализировано.";

// #962 / session 21b928cf: two live false fires that carry sub-step completion
// verbs + refs (so they trip isCompletionReport) yet use natural status prose
// WITHOUT any #855 interim marker (⏳/checkpoint/WIP/жду CI/…) — the gap #855
// left open. Both frame work as still in motion / a next action proposed, not
// the task closed.
//
// Shape 1 — mid-flight WAVE STATUS: a merged-bullet list of landed sub-steps
// followed by starting the next dispatch / an in-flight subagent.
const INFLIGHT_WAVE_STATUS =
  "Волна триажа в движении:\n" +
  "- #960 → merged (squash), ветка удалена.\n" +
  "- #955 → closed как дубль.\n" +
  "- #958 → merged.\n\n" +
  "Приступаю к следующему диспатчу. Субагент ещё работает — жду возврата, " +
  "продолжу автономно после.";
// Shape 2 — /wrap PROPOSAL: a merged-bullet summary + proposing to START wrap.
const WRAP_PROPOSAL =
  "Сессия к завершению — вся волна смержена:\n" +
  "- #960 смержен, #955 смержен, #958 смержен.\n\n" +
  "Предлагаю запустить /wrap-цикл: независимое ретро → propose → apply → " +
  "hygiene. Приступаю к стадии 1.";
// Regression guard — a GENUINE terminal report (product-first summary + refs +
// «смержен» + «🖼 Проверить глазами», with a «что дальше» handoff section) that
// is MISSING «📈». This MUST still fire: the #962 recognizer keys on proposal /
// in-flight FRAMING verbs, never on the bare «дальше»/"next" of a handoff tail.
const GENUINE_REPORT_NO_MARKER =
  "Готово: реализована precision-фикс completion-report-гейта.\n" +
  "- PR #965 смержен (squash), Issue #962 закрыта, CI зелёный.\n" +
  "- Ветка удалена, board Status = Done.\n\n" +
  "🖼 Проверить глазами: `pnpm --filter @ds/lint-guard-tests test` — " +
  "новые фикстуры зелёные.\n\n" +
  "Что дальше: следующая волна — дренаж debt-бэклога.";
// Regression guard #2 (#966 Mode-a) — a GENUINE terminal report whose tech
// appendix narrates COMPLETED sub-steps in the PAST tense ("dispatched N
// subagents" / «диспатчил»), MISSING «📈». Past-tense completed narration must
// NOT be read as in-flight framing, so this MUST still fire — it locks the
// false-negative (a real report silently exempted) closed.
const GENUINE_REPORT_PAST_DISPATCH =
  "Готово: волна из трёх PR закрыта.\n" +
  "- #970 merged, #971 merged, #972 merged; ветки удалены, board = Done.\n\n" +
  "Tech appendix: dispatched 3 subagents in parallel, all merged on green CI. " +
  "Диспатчил ревьюера Mode-a по каждому — все APPROVE.\n\n" +
  "🖼 Проверить глазами: `gh pr list --state merged`.";

describe("completion-report-gate hook (spawned end-to-end)", () => {
  it("blocks (exit 2) a completion report missing «📈», naming report-task-outcome", () => {
    const r = runHook(stopPayload(transcriptWith(COMPLETION_NO_MARKER)));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("report-task-outcome");
    expect(r.stderr).toContain(
      "apps/docs/content/skills/report-task-outcome/SKILL.md",
    );
    expect(r.stderr).toContain("📈 % от запланированного");
  });

  it("allows (exit 0) the same report once the «📈» section is present", () => {
    const r = runHook(stopPayload(transcriptWith(COMPLETION_WITH_MARKER)));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("allows a status update (refs but no completion verb)", () => {
    const r = runHook(
      stopPayload(
        transcriptWith(
          "PR #833 открыт, жду вердикта Mode (a); CI ещё бежит — статус сообщу.",
        ),
      ),
    );
    expect(r.status).toBe(0);
  });

  it("allows a question to the owner", () => {
    const r = runHook(
      stopPayload(
        transcriptWith(
          "⏸ ЖДУ ВАС: какой вариант дизайна для #824 выбрать — A или B?",
        ),
      ),
    );
    expect(r.status).toBe(0);
  });

  it("allows a handoff prompt (work in flight, no completion verbs)", () => {
    const r = runHook(
      stopPayload(
        transcriptWith(
          "Handoff: продолжи работу над Issue #824 — worktree создан, " +
            "план в стоп-стейт комментарии, следующий шаг — тесты.",
        ),
      ),
    );
    expect(r.status).toBe(0);
  });

  it("allows the observed 2026-07-13 /wrap stage-2 approval-request (live FP, #839)", () => {
    const r = runHook(stopPayload(transcriptWith(LIVE_FP_STAGE2)));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("allows a decision-request ending in a question despite completion verbs + refs", () => {
    const r = runHook(
      stopPayload(
        transcriptWith(
          "PR #812 смержен, Issue #811 закрыта. Открывать ли follow-up на рефактор?",
        ),
      ),
    );
    expect(r.status).toBe(0);
  });

  it("allows the 2026-07-13 in-flight checkpoint (#855: verbs+ref but ALIVE/жду вердикт)", () => {
    const r = runHook(stopPayload(transcriptWith(INTERIM_CHECKPOINT_ALIVE)));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("allows an interim checkpoint carrying a SUB-STEP verb + ref (#855 regressed case)", () => {
    const r = runHook(stopPayload(transcriptWith(INTERIM_CHECKPOINT_SUBSTEP)));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("allows the mid-flight wave-status false fire (#962: merged bullets + next-dispatch/in-flight prose)", () => {
    const r = runHook(stopPayload(transcriptWith(INFLIGHT_WAVE_STATUS)));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("allows the /wrap-proposal false fire (#962: merged bullets + «предлагаю запустить /wrap»)", () => {
    const r = runHook(stopPayload(transcriptWith(WRAP_PROPOSAL)));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("STILL blocks a genuine terminal report missing «📈» with a «что дальше» tail (#962 regression guard)", () => {
    const r = runHook(stopPayload(transcriptWith(GENUINE_REPORT_NO_MARKER)));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("report-task-outcome");
  });

  it("STILL blocks a genuine report whose appendix narrates PAST-tense «dispatched»/«диспатчил» (#966 false-negative guard)", () => {
    const r = runHook(stopPayload(transcriptWith(GENUINE_REPORT_PAST_DISPATCH)));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("report-task-outcome");
  });

  it("allows a completion report whose «📈» heading is BOLDED (#893)", () => {
    const r = runHook(
      stopPayload(
        transcriptWith(
          COMPLETION_NO_MARKER +
            "\n\n**📈 % от запланированного:** 100% — весь скоуп.",
        ),
      ),
    );
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("allows a completion report whose «📈» section is a `##` heading (#893)", () => {
    const r = runHook(
      stopPayload(
        transcriptWith(
          COMPLETION_NO_MARKER + "\n\n## 📈 % от запланированного\n100%.",
        ),
      ),
    );
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("still blocks a markerless completion report that merely MENTIONS a question mid-text", () => {
    const r = runHook(
      stopPayload(
        transcriptWith(
          "Вопрос «нужен ли рефакторинг?» отложен в #825. " +
            COMPLETION_NO_MARKER,
        ),
      ),
    );
    expect(r.status).toBe(2);
  });

  it("never blocks when stop_hook_active is true (loop guard)", () => {
    const r = runHook(stopPayload(transcriptWith(COMPLETION_NO_MARKER), true));
    expect(r.status).toBe(0);
  });

  it("fails open on a missing transcript file", () => {
    const r = runHook(stopPayload(join(DIR, "does-not-exist.jsonl")));
    expect(r.status).toBe(0);
  });

  it("fails open on a garbage transcript", () => {
    const p = join(DIR, "garbage.jsonl");
    writeFileSync(p, "not json at all\n{{{\n00000001", "utf8");
    expect(runHook(stopPayload(p)).status).toBe(0);
  });

  it("fails open on garbage stdin", () => {
    expect(runHook("not-json{{{").status).toBe(0);
  });

  it("fails open when transcript_path is absent from the payload", () => {
    expect(runHook({ session_id: "s", hook_event_name: "Stop" }).status).toBe(
      0,
    );
  });
});

describe("isCompletionReport()", () => {
  it("matches RU completion verbs + refs", () => {
    expect(isCompletionReport("Задача выполнена, см. PR №812.")).toBe(true);
    expect(isCompletionReport("Итерация завершена: #815 закрыт.")).toBe(true);
    expect(isCompletionReport("Всё завершёно по #815.")).toBe(true);
  });

  it("matches EN merged + refs", () => {
    expect(isCompletionReport("PR #812 merged, issue closed.")).toBe(true);
  });

  it("needs BOTH a completion verb and a ref", () => {
    expect(isCompletionReport("PR #833 открыт, жду CI.")).toBe(false); // ref only
    expect(isCompletionReport("Работа выполнена полностью.")).toBe(false); // verb only
    expect(isCompletionReport("Что делаем дальше?")).toBe(false);
  });

  it("does not treat 'merge' inside other words as the verb", () => {
    expect(isCompletionReport("Готовлю merge-план для #824.")).toBe(false);
  });

  it("does not treat NEGATED completion verbs as completion (#838 review NIT)", () => {
    expect(isCompletionReport("PR #833 не смержен, жду вердикта.")).toBe(false);
    expect(isCompletionReport("PR #833 ещё не смержен — CI красный.")).toBe(
      false,
    );
    expect(
      isCompletionReport("Итерация #815 не завершена, остался тест."),
    ).toBe(false);
    expect(isCompletionReport("PR #812 is not merged yet.")).toBe(false);
    // …but a positive verb alongside a negated one still counts
    expect(isCompletionReport("PR #810 смержен; PR #833 не смержен.")).toBe(
      true,
    );
  });
});

describe("isDecisionRequest()", () => {
  it("matches the «ЖДУ ВАС» handback marker anywhere in the turn", () => {
    expect(isDecisionRequest(LIVE_FP_STAGE2)).toBe(true);
  });

  it("matches a turn whose last line ends with a question mark", () => {
    expect(isDecisionRequest("PR #812 смержен. Открывать ли follow-up?")).toBe(
      true,
    );
    expect(
      isDecisionRequest(
        "Вариант A или B?\n\n1. A — быстрее\n2. B — чище\n\nЧто выбираем?",
      ),
    ).toBe(true);
  });

  it("matches a trailing question wrapped in markdown emphasis", () => {
    expect(isDecisionRequest("Итог по #812.\n\n**Мержим сейчас?**")).toBe(true);
  });

  it("rejects a plain completion report (question only mid-text)", () => {
    expect(isDecisionRequest(COMPLETION_NO_MARKER)).toBe(false);
    expect(
      isDecisionRequest(
        "Вопрос «зачем?» закрыт в #825. Всё смержено, PR #810.",
      ),
    ).toBe(false);
    expect(isDecisionRequest("")).toBe(false);
  });
});

describe("isInterimStatus() (#855)", () => {
  it("matches in-flight checkpoint language (verbs+ref but not terminal)", () => {
    expect(isInterimStatus(INTERIM_CHECKPOINT_ALIVE)).toBe(true);
    expect(isInterimStatus(INTERIM_CHECKPOINT_SUBSTEP)).toBe(true);
    expect(isInterimStatus("⏳ probe #828: STILL-CLEAN, жду CI.")).toBe(true);
    expect(isInterimStatus("WIP: слайс в работе, ещё не завершён.")).toBe(true);
  });

  it("is FALSE for a settled completion report (no-regression)", () => {
    expect(isInterimStatus(COMPLETION_NO_MARKER)).toBe(false);
    expect(isInterimStatus(COMPLETION_WITH_MARKER)).toBe(false);
  });
});

describe("isProposalOrInFlight() (#962)", () => {
  it("matches the two live false-fire shapes", () => {
    expect(isProposalOrInFlight(INFLIGHT_WAVE_STATUS)).toBe(true);
    expect(isProposalOrInFlight(WRAP_PROPOSAL)).toBe(true);
  });

  it("matches proposal / in-flight framing verbs (RU+EN)", () => {
    expect(isProposalOrInFlight("Предлагаю открыть follow-up.")).toBe(true);
    expect(isProposalOrInFlight("Proposing to split #900 into two.")).toBe(
      true,
    );
    expect(isProposalOrInFlight("Приступаю к следующей волне.")).toBe(true);
    expect(isProposalOrInFlight("About to dispatch the reviewer.")).toBe(true);
    expect(isProposalOrInFlight("Субагент ещё работает — жду возврата.")).toBe(
      true,
    );
    expect(isProposalOrInFlight("Subagent still running on #900.")).toBe(true);
  });

  it("is FALSE for a genuine terminal report incl. its «что дальше»/next tail", () => {
    expect(isProposalOrInFlight(GENUINE_REPORT_NO_MARKER)).toBe(false);
    expect(isProposalOrInFlight(COMPLETION_NO_MARKER)).toBe(false);
    expect(isProposalOrInFlight(COMPLETION_WITH_MARKER)).toBe(false);
    // the bare handoff words must NOT trip it (only framing verbs do)
    expect(isProposalOrInFlight("Что дальше: следующая волна.")).toBe(false);
    expect(isProposalOrInFlight("Next steps: drain the debt backlog.")).toBe(
      false,
    );
  });

  it("is FALSE for PAST-tense completed narration — «dispatched»/«диспатчил» (#966)", () => {
    // completed sub-steps a real report's appendix uses — NOT in-flight framing
    expect(isProposalOrInFlight(GENUINE_REPORT_PAST_DISPATCH)).toBe(false);
    expect(isProposalOrInFlight("dispatched 3 subagents, all merged.")).toBe(
      false,
    );
    expect(isProposalOrInFlight("Диспатчил ревьюера — APPROVE.")).toBe(false);
    // …but present/gerund in-flight forms still DO trip it
    expect(isProposalOrInFlight("now dispatching the reviewer for #900")).toBe(
      true,
    );
    expect(isProposalOrInFlight("Диспатчирую субагента по #900.")).toBe(true);
  });
});

describe("extractLastAssistantText()", () => {
  it("returns only the LAST assistant turn (earlier completion text ignored)", () => {
    const jsonl = [
      JSON.stringify({
        type: "assistant",
        message: {
          id: "m1",
          content: [{ type: "text", text: COMPLETION_NO_MARKER }],
        },
      }),
      JSON.stringify({ type: "user", message: { content: "а дальше?" } }),
      JSON.stringify({
        type: "assistant",
        message: {
          id: "m2",
          content: [{ type: "text", text: "Дальше — Issue #825, план ниже." }],
        },
      }),
    ].join("\n");
    const text = extractLastAssistantText(jsonl);
    expect(text).toBe("Дальше — Issue #825, план ниже.");
    expect(
      decideBlock({ stopHookActive: false, lastAssistantText: text }),
    ).toEqual({ block: false });
  });

  it("concatenates a turn split across entries sharing one message id", () => {
    const jsonl = [
      JSON.stringify({
        type: "assistant",
        message: {
          id: "m9",
          content: [{ type: "text", text: "PR #810 смержен." }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          id: "m9",
          content: [{ type: "text", text: "Ветка удалена." }],
        },
      }),
    ].join("\n");
    expect(extractLastAssistantText(jsonl)).toBe(
      "PR #810 смержен.\nВетка удалена.",
    );
  });

  it("handles string content and skips tool_use-only / malformed lines", () => {
    const jsonl = [
      "{{{ malformed",
      JSON.stringify({
        type: "assistant",
        message: { id: "m3", content: "строковый контент #1 выполнен" },
      }),
      JSON.stringify({
        type: "assistant",
        message: { id: "m4", content: [{ type: "tool_use", name: "Bash" }] },
      }),
    ].join("\n");
    // last turn (m4) has no text → null, and the gate stays silent on null
    expect(extractLastAssistantText(jsonl)).toBeNull();
    expect(
      decideBlock({ stopHookActive: false, lastAssistantText: null }).block,
    ).toBe(false);
  });

  it("returns null for an empty / assistant-free transcript", () => {
    expect(extractLastAssistantText("")).toBeNull();
    expect(
      extractLastAssistantText(
        JSON.stringify({ type: "user", message: { content: "hi" } }),
      ),
    ).toBeNull();
  });
});

describe("decideBlock()", () => {
  const completion = {
    stopHookActive: false,
    lastAssistantText: COMPLETION_NO_MARKER,
  };

  it("blocks a markerless completion report", () => {
    expect(decideBlock(completion)).toEqual({ block: true });
  });

  it("passes once the marker is present", () => {
    expect(
      decideBlock({
        stopHookActive: false,
        lastAssistantText: COMPLETION_WITH_MARKER,
      }).block,
    ).toBe(false);
    expect(COMPLETION_WITH_MARKER).toContain(REPORT_MARKER);
  });

  it("never blocks under stop_hook_active", () => {
    expect(decideBlock({ ...completion, stopHookActive: true }).block).toBe(
      false,
    );
  });

  it("never blocks a decision-request turn even with completion verbs + refs (#839)", () => {
    expect(
      decideBlock({ stopHookActive: false, lastAssistantText: LIVE_FP_STAGE2 })
        .block,
    ).toBe(false);
  });

  it("never blocks an in-flight checkpoint with a sub-step verb + ref (#855)", () => {
    expect(
      decideBlock({
        stopHookActive: false,
        lastAssistantText: INTERIM_CHECKPOINT_SUBSTEP,
      }).block,
    ).toBe(false);
  });

  it("no-regression: interim recognizer stays clear of a real report — it still blocks (#855)", () => {
    // COMPLETION_NO_MARKER must NOT read as interim, so the gate keeps firing.
    expect(isInterimStatus(COMPLETION_NO_MARKER)).toBe(false);
    expect(decideBlock(completion)).toEqual({ block: true });
  });

  it("never blocks the mid-flight wave-status false fire (#962)", () => {
    expect(
      decideBlock({
        stopHookActive: false,
        lastAssistantText: INFLIGHT_WAVE_STATUS,
      }).block,
    ).toBe(false);
    // it WOULD have tripped the report heuristic without the recognizer
    expect(isCompletionReport(INFLIGHT_WAVE_STATUS)).toBe(true);
  });

  it("never blocks the /wrap-proposal false fire (#962)", () => {
    expect(
      decideBlock({ stopHookActive: false, lastAssistantText: WRAP_PROPOSAL })
        .block,
    ).toBe(false);
    expect(isCompletionReport(WRAP_PROPOSAL)).toBe(true);
  });

  it("STILL blocks a genuine terminal report missing «📈» (#962 regression guard)", () => {
    expect(GENUINE_REPORT_NO_MARKER).not.toContain(REPORT_MARKER);
    expect(isProposalOrInFlight(GENUINE_REPORT_NO_MARKER)).toBe(false);
    expect(
      decideBlock({
        stopHookActive: false,
        lastAssistantText: GENUINE_REPORT_NO_MARKER,
      }),
    ).toEqual({ block: true });
  });

  it("STILL blocks a genuine report with PAST-tense «dispatched»/«диспатчил» appendix (#966 false-negative guard)", () => {
    expect(GENUINE_REPORT_PAST_DISPATCH).not.toContain(REPORT_MARKER);
    expect(isProposalOrInFlight(GENUINE_REPORT_PAST_DISPATCH)).toBe(false);
    expect(isCompletionReport(GENUINE_REPORT_PAST_DISPATCH)).toBe(true);
    expect(
      decideBlock({
        stopHookActive: false,
        lastAssistantText: GENUINE_REPORT_PAST_DISPATCH,
      }),
    ).toEqual({ block: true });
  });

  it("passes a report whose 📈 section is wrapped in bold / heading markup (#893)", () => {
    expect(
      decideBlock({
        stopHookActive: false,
        lastAssistantText:
          COMPLETION_NO_MARKER + "\n\n**📈 % от запланированного:** 100%.",
      }).block,
    ).toBe(false);
    expect(
      decideBlock({
        stopHookActive: false,
        lastAssistantText:
          COMPLETION_NO_MARKER + "\n\n## 📈 % от запланированного\n100%.",
      }).block,
    ).toBe(false);
  });

  it("still blocks when the 📈 section is genuinely missing (#893 no-weakening)", () => {
    expect(COMPLETION_NO_MARKER).not.toContain(REPORT_MARKER);
    expect(decideBlock(completion)).toEqual({ block: true });
  });
});

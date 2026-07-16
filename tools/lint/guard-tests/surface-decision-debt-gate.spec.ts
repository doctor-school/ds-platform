import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// The hook is plain ESM JS (runs under bare `node` from settings.json), so the
// spec imports its pure seams directly — same pattern as the sibling
// completion-report-gate spec.
import {
  DEBT_MARKER_RE,
  decideBlock,
  hasDecisionDebtLine,
} from "../../hooks/surface-decision-debt-gate.mjs";

/**
 * Cover for the #970 surface-decision-debt gate (Stop hook): a final assistant
 * message that reads as a task-completion report (the SAME recognizer as the
 * #824 completion-report gate) but lacks a `surface-decision-debt:` line blocks
 * the stop (exit 2 + corrective stderr naming the gate + AGENTS.md §3.8);
 * everything else — a report carrying `surface-decision-debt: []` or a list,
 * non-completion turns (decision-request / interim status / proposal-or-in-
 * flight), `stop_hook_active`, unreadable transcript — allows the stop (exit 0,
 * fail-open).
 *
 * Fixture transcripts are written into an `os.tmpdir()` temp dir at test time
 * and every path is built via `path.join` — no drive-letter literals, so the
 * spec runs identically on Windows and the Linux CI runner.
 */

const HOOK = fileURLToPath(
  new URL("../../hooks/surface-decision-debt-gate.mjs", import.meta.url),
);

const DIR = mkdtempSync(join(tmpdir(), "surface-decision-debt-gate-"));
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
  session_id: "s-970",
  transcript_path: transcriptPath,
  hook_event_name: "Stop",
  stop_hook_active: stopHookActive,
});

// A terminal completion report (completion verbs + refs) with NO
// `surface-decision-debt:` line — this MUST block.
const COMPLETION_NO_DEBT =
  "Готово: PR #810 смержен (squash), Issue #806 закрыта, CI зелёный. " +
  "Ветка удалена, board Status = Done.";
// The same report carrying an empty debt line — passes.
const COMPLETION_DEBT_EMPTY =
  COMPLETION_NO_DEBT + "\n\nsurface-decision-debt: []";
// The same report carrying a debt LIST — passes.
const COMPLETION_DEBT_LIST =
  COMPLETION_NO_DEBT +
  "\n\nsurface-decision-debt:\n" +
  "- committed with --no-verify (rationale: prettier reformatted an " +
  "unrelated generated file) — logged in the PR body.";

// Exemption fixtures — the shared recognizer must keep the gate silent on these
// (they are NOT terminal completion reports), so a missing debt line is
// irrelevant.
const DECISION_REQUEST =
  "PR #812 смержен, Issue #811 закрыта. Открывать ли follow-up на рефактор?";
const INTERIM_STATUS =
  "Checkpoint: #828 смержен в ветку, жду CI. Пока ничего не финализировано.";
const PROPOSAL_INFLIGHT =
  "Сессия к завершению — вся волна смержена:\n" +
  "- #960 смержен, #955 смержен, #958 смержен.\n\n" +
  "Предлагаю запустить /wrap-цикл. Приступаю к стадии 1.";
const NON_COMPLETION = "PR #833 открыт, жду вердикта Mode (a); CI ещё бежит.";

// #990: explicit interim-marker OPENINGS (shared recognizer, imported from
// completion-report-gate.mjs) — verbs + refs present, но турн объявляет себя
// промежуточным at the opening. None may fire this gate either.
const INTERIM_990_MARKER_TABLE =
  "⏳ Промежуточный статус — не завершающий отчёт, работа в полёте.\n\n" +
  "| Субагент | Состояние |\n| --- | --- |\n" +
  "| #987 | смержен |\n| #988 | на ревью |\n| #990 | в очереди |";
const INTERIM_990_VARIANTS = [
  "Промежуточный статус: PR #987 смержен, остальные в очереди.",
  "Интерим: половина волны смержена (#955), вторая половина в очереди.",
  "Interim: PR #987 merged, second half of the wave still queued.",
  "In flight: #987 merged, the rest of the wave queued behind it.",
];
// #990 regression guard: a GENUINE terminal report (no opening marker, no
// debt line) that merely MENTIONS "interim" mid-body — past the 200-char
// opening slice — must STILL fire.
const GENUINE_REPORT_MIDBODY_INTERIM =
  "Готово: PR #990 смержен (squash), Issue #990 закрыта, CI зелёный.\n" +
  "Ветка удалена, board Status = Done, все гейты пройдены вручную, Mode-a " +
  "APPROVE получен на текущем head SHA.\n" +
  "Волна закрыта полностью, дополнительных изменений не потребовалось, " +
  "статус финальный, ничего не отложено.\n\n" +
  "Tech appendix: the interim fix shipped in the same PR; % от " +
  "запланированного — весь скоуп, но маркер-эмодзи отсутствует.";

describe("surface-decision-debt-gate hook (spawned end-to-end)", () => {
  it("blocks (exit 2) a completion report missing a surface-decision-debt line, naming the gate + AGENTS.md §3.8", () => {
    const r = runHook(stopPayload(transcriptWith(COMPLETION_NO_DEBT)));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("surface-decision-debt");
    expect(r.stderr).toContain("AGENTS.md §3.8");
  });

  it("allows (exit 0) a report carrying `surface-decision-debt: []`", () => {
    const r = runHook(stopPayload(transcriptWith(COMPLETION_DEBT_EMPTY)));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("allows (exit 0) a report carrying `surface-decision-debt:` + a list", () => {
    const r = runHook(stopPayload(transcriptWith(COMPLETION_DEBT_LIST)));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("does not fire on a decision-request turn (exemption)", () => {
    const r = runHook(stopPayload(transcriptWith(DECISION_REQUEST)));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("does not fire on an interim-status checkpoint (exemption)", () => {
    const r = runHook(stopPayload(transcriptWith(INTERIM_STATUS)));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("does not fire on a proposal / in-flight turn (exemption)", () => {
    const r = runHook(stopPayload(transcriptWith(PROPOSAL_INFLIGHT)));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("does not fire on a non-completion status turn (no completion verb)", () => {
    const r = runHook(stopPayload(transcriptWith(NON_COMPLETION)));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("does not fire on the #990 interim-marker opening + subagent-state table", () => {
    const r = runHook(stopPayload(transcriptWith(INTERIM_990_MARKER_TABLE)));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("does not fire on any #990 marker-phrase opening variant", () => {
    for (const text of INTERIM_990_VARIANTS) {
      const r = runHook(stopPayload(transcriptWith(text)));
      expect(r.status, text).toBe(0);
      expect(r.stderr, text).toBe("");
    }
  });

  it("STILL fires on a genuine report mentioning 'interim' mid-body only (#990 opening-anchor guard)", () => {
    const r = runHook(
      stopPayload(transcriptWith(GENUINE_REPORT_MIDBODY_INTERIM)),
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("surface-decision-debt");
  });

  it("never blocks when stop_hook_active is true (loop guard)", () => {
    const r = runHook(stopPayload(transcriptWith(COMPLETION_NO_DEBT), true));
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

describe("hasDecisionDebtLine()", () => {
  it("matches an empty `[]` and a list form", () => {
    expect(hasDecisionDebtLine("surface-decision-debt: []")).toBe(true);
    expect(hasDecisionDebtLine("surface-decision-debt:\n- foo")).toBe(true);
  });

  it("is case-insensitive and tolerates whitespace before the colon", () => {
    expect(hasDecisionDebtLine("Surface-Decision-Debt : []")).toBe(true);
    expect(hasDecisionDebtLine("**surface-decision-debt:** []")).toBe(true);
  });

  it("is FALSE when the marker is absent", () => {
    expect(hasDecisionDebtLine(COMPLETION_NO_DEBT)).toBe(false);
    expect(hasDecisionDebtLine("")).toBe(false);
    // the bare skill name without the colon marker does not count
    expect(hasDecisionDebtLine("ran the surface-decision-debt skill")).toBe(
      false,
    );
  });

  it("DEBT_MARKER_RE is exported and matches the token", () => {
    expect(DEBT_MARKER_RE.test("surface-decision-debt:")).toBe(true);
  });
});

describe("decideBlock() (#970)", () => {
  const completion = {
    stopHookActive: false,
    lastAssistantText: COMPLETION_NO_DEBT,
  };

  it("blocks a completion report with no debt line", () => {
    expect(decideBlock(completion)).toEqual({ block: true });
  });

  it("passes once a debt line is present (empty or list)", () => {
    expect(
      decideBlock({
        stopHookActive: false,
        lastAssistantText: COMPLETION_DEBT_EMPTY,
      }).block,
    ).toBe(false);
    expect(
      decideBlock({
        stopHookActive: false,
        lastAssistantText: COMPLETION_DEBT_LIST,
      }).block,
    ).toBe(false);
  });

  it("never blocks under stop_hook_active (loop guard)", () => {
    expect(decideBlock({ ...completion, stopHookActive: true }).block).toBe(
      false,
    );
  });

  it("never blocks null / empty last text (fail-open seam)", () => {
    expect(
      decideBlock({ stopHookActive: false, lastAssistantText: null }).block,
    ).toBe(false);
  });

  it("never blocks the shared-recognizer exemptions", () => {
    for (const text of [
      DECISION_REQUEST,
      INTERIM_STATUS,
      PROPOSAL_INFLIGHT,
      NON_COMPLETION,
    ]) {
      expect(
        decideBlock({ stopHookActive: false, lastAssistantText: text }).block,
      ).toBe(false);
    }
  });
});

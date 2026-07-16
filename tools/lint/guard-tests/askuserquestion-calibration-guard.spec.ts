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
  restoreScopeHit,
  surfaceClaimHit,
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

// (#976 fixture, real incident) A restore/remediation-SCOPE question framed as
// an owner menu — after erroneously deleting a section, the lead asks the owner
// «what scope do we restore?». Restoring a mistake is a LEAD call (minimal-diff,
// faithful, full restore), not an owner scope pick → the gate WARNs.
const RESTORE_SCOPE_INPUT = {
  questions: [
    {
      question:
        "Ошибочно удалил секцию из ADR — что восстанавливаем: только удалённый текст или весь файл целиком?",
      header: "Объём восстановления",
      options: [
        { label: "Только удалённый текст", description: "Точечно вернуть секцию" },
        { label: "Весь файл", description: "Откатить файл целиком" },
      ],
    },
  ],
};

// (#976 fixture, EN framing) The same shape in English — a restore-scope menu.
const RESTORE_SCOPE_EN_INPUT = {
  questions: [
    {
      question: "To what scope should we restore the reverted config?",
      header: "Restore scope",
      options: [
        { label: "Only the removed key", description: "Restore just that entry" },
        { label: "The whole file", description: "Restore the entire file" },
      ],
    },
  ],
};

// (#976 fixture, real incident) A question whose OPTION asserts an UNVERIFIED
// factual claim about a live surface («сегодняшний /account — это сырой
// debug-дамп»). Such a state claim must be verified against source first → WARN.
const SURFACE_CLAIM_INPUT = {
  questions: [
    {
      question: "Как поступить со страницей аккаунта?",
      header: "Страница /account",
      options: [
        {
          label: "Переписать",
          description: "Сегодняшний /account — это сырой debug-дамп, переделать начисто",
        },
        { label: "Оставить", description: "Ничего не менять" },
      ],
    },
  ],
};

// (#976 fixture, EN framing) An option asserts an endpoint returns a given shape.
const SURFACE_CLAIM_EN_INPUT = {
  questions: [
    {
      question: "How to handle the health check?",
      header: "Health",
      options: [
        { label: "Trust it", description: "The /v1/health endpoint returns a stale 200" },
        { label: "Probe", description: "Re-check first" },
      ],
    },
  ],
};

// (#976 regression) A legit PRODUCT question that merely CONTAINS a restore word
// (password-recovery flow naming) but is NOT a restore-scope decision — the
// restore verb and any scope word live in DIFFERENT copy strings, so the gate
// must NOT WARN restore-scope on it.
const PRODUCT_RESTORE_WORD_INPUT = {
  questions: [
    {
      question: "Как назвать флоу восстановления доступа?",
      header: "Название флоу",
      options: [
        { label: "Только e-mail", description: "Короткий вариант" },
        { label: "E-mail и SMS", description: "Полный вариант" },
      ],
    },
  ],
};

// (#976 regression) A legit PRODUCT-scope question that names a surface noun
// (страница / page) but asserts NO state claim — a "which page to route to"
// product pick. Surface noun WITHOUT a state predicate must NOT WARN.
const PRODUCT_SURFACE_NOUN_INPUT = {
  questions: [
    {
      question: "На какую страницу вести пользователя после входа?",
      header: "Пункт назначения",
      options: [
        { label: "Дашборд", description: "Сразу к сводке" },
        { label: "Профиль", description: "Сначала настройки профиля" },
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

  it("appends a restore-scope WARN on a restore/remediation-scope owner menu (RU)", () => {
    const r = runHook(preToolUsePayload(RESTORE_SCOPE_INPUT));
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.systemMessage).toContain("restore/remediation-scope (#976)");
    expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("appends a live-surface-claim WARN when an option asserts an unverified state claim (RU /account)", () => {
    const r = runHook(preToolUsePayload(SURFACE_CLAIM_INPUT));
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.systemMessage).toContain("live-surface claim (#976)");
    expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("does NOT warn restore/surface on a clean product question (no regression)", () => {
    const r = runHook(preToolUsePayload(CLEAN_PRODUCT_INPUT));
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.systemMessage).toBe(calibrationMessage());
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

  it("flags a restore-scope owner menu (RU + EN) and appends the WARN", () => {
    for (const input of [RESTORE_SCOPE_INPUT, RESTORE_SCOPE_EN_INPUT]) {
      const { systemMessage, restoreScope } = evaluateAskUserQuestion(input);
      expect(restoreScope).toBe(true);
      expect(systemMessage).toContain("restore/remediation-scope (#976)");
    }
  });

  it("flags an unverified live-surface claim (RU + EN) and appends the WARN", () => {
    for (const input of [SURFACE_CLAIM_INPUT, SURFACE_CLAIM_EN_INPUT]) {
      const { systemMessage, surfaceClaim } = evaluateAskUserQuestion(input);
      expect(surfaceClaim).toBe(true);
      expect(systemMessage).toContain("live-surface claim (#976)");
    }
  });

  it("does NOT flag legit product questions (restore-word / surface-noun regression)", () => {
    for (const input of [
      CLEAN_PRODUCT_INPUT,
      PRODUCT_RESTORE_WORD_INPUT,
      PRODUCT_SURFACE_NOUN_INPUT,
    ]) {
      const { systemMessage, restoreScope, surfaceClaim } =
        evaluateAskUserQuestion(input);
      expect(restoreScope).toBe(false);
      expect(surfaceClaim).toBe(false);
      expect(systemMessage).toBe(calibrationMessage());
    }
  });
});

describe("restoreScopeHit() (#976 — restore/remediation-scope framing)", () => {
  it("fires when a restore verb and a scope cue share the copy (RU + EN)", () => {
    expect(
      restoreScopeHit([
        "что восстанавливаем: только удалённый текст или весь файл?",
      ]),
    ).toBe(true);
    expect(restoreScopeHit(["To what scope should we restore the config?"])).toBe(
      true,
    );
    expect(restoreScopeHit(["Откатить файл целиком или частично?"])).toBe(true);
  });

  it("does NOT fire when restore verb and scope cue are in DIFFERENT strings", () => {
    // password-recovery flow naming — restore word in Q, scope word in an option
    expect(
      restoreScopeHit(["Как назвать флоу восстановления доступа?", "Только e-mail"]),
    ).toBe(false);
  });

  it("does NOT fire on a scope word alone or a restore word alone", () => {
    expect(restoreScopeHit(["Только синий или весь градиент?"])).toBe(false);
    expect(restoreScopeHit(["Как назвать восстановление пароля?"])).toBe(false);
  });

  it("does NOT false-positive on 'верный/верно' (correct), only real restore verbs", () => {
    expect(restoreScopeHit(["Какой вариант верный — весь список или только топ?"])).toBe(
      false,
    );
  });

  it("returns false for empty / malformed input without throwing", () => {
    expect(restoreScopeHit([])).toBe(false);
    expect(restoreScopeHit(null)).toBe(false);
    expect(restoreScopeHit(undefined)).toBe(false);
  });
});

describe("surfaceClaimHit() (#976 — unverified live-surface state claim)", () => {
  it("fires on a path/endpoint/surface + asserted-state predicate (RU + EN)", () => {
    expect(
      surfaceClaimHit(["Сегодняшний /account — это сырой debug-дамп"]),
    ).toBe(true);
    expect(surfaceClaimHit(["The /v1/health endpoint returns a stale 200"])).toBe(
      true,
    );
    expect(surfaceClaimHit(["the /foo page is a stub"])).toBe(true);
    expect(surfaceClaimHit(["страница профиля содержит заглушку"])).toBe(true);
  });

  it("does NOT fire on a surface noun WITHOUT a state predicate (product routing pick)", () => {
    expect(
      surfaceClaimHit(["На какую страницу вести после входа?", "Дашборд", "Профиль"]),
    ).toBe(false);
  });

  it("does NOT fire on a state predicate WITHOUT a surface reference", () => {
    expect(surfaceClaimHit(["Синий — это спокойнее, а корал ярче"])).toBe(false);
  });

  it("returns false for empty / malformed input without throwing", () => {
    expect(surfaceClaimHit([])).toBe(false);
    expect(surfaceClaimHit(null)).toBe(false);
    expect(surfaceClaimHit(undefined)).toBe(false);
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

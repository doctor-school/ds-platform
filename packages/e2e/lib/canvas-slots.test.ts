import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  applySlotAllowlist,
  diffSlots,
  maskSlotDigits,
  type SlotStructure,
} from "./canvas-slots.js";
import type { AllowlistEntry } from "./canvas-structure.js";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

describe("canvas-slots · diffSlots", () => {
  const canvas: SlotStructure = {
    chrome: [{ kind: "link", label: "Все события →" }],
    cards: [
      ["link", "button"],
      ["link", "button"],
      ["link", "button"],
    ],
  };

  it("passes on a different card COUNT and different card data — only shapes are compared", () => {
    expect(
      diffSlots(canvas, {
        chrome: [{ kind: "link", label: "Все события →" }],
        cards: [
          ["link", "button"],
          ["link", "button"],
          ["link", "button"],
          ["link", "button"],
          ["link", "button"],
        ],
      }),
    ).toEqual([]);
  });

  it("fails a control missing from every card", () => {
    expect(
      diffSlots(canvas, { chrome: canvas.chrome, cards: [["link"], ["link"]] }),
    ).toEqual([
      "card shape: app [link] on 2 card(s) — the canvas draws [link · button]",
    ]);
  });

  it("fails a control moved from the cards into the section chrome (the #3629 class)", () => {
    expect(
      diffSlots(canvas, {
        chrome: [...canvas.chrome, { kind: "button", label: "Записаться" }],
        cards: [["link"], ["link"]],
      }),
    ).toEqual([
      "extra in app (chrome): button «Записаться»",
      "card shape: app [link] on 2 card(s) — the canvas draws [link · button]",
    ]);
  });

  it("fails a chrome control moved into the cards, and a missing chrome link", () => {
    expect(
      diffSlots(canvas, {
        chrome: [],
        cards: [["link", "button", "link"]],
      }),
    ).toEqual([
      "missing in app (chrome): link «Все события →»",
      "card shape: app [link · button · link] on 1 card(s) — the canvas draws [link · button]",
    ]);
  });

  it("fails a section that renders no cards where the canvas repeats them", () => {
    expect(diffSlots(canvas, { chrome: canvas.chrome, cards: [] })).toEqual([
      "cards: the canvas repeats cards here, the app renders none",
    ]);
  });
});

describe("canvas-slots · #3757 digit masking", () => {
  const canvas: SlotStructure = {
    chrome: [
      { kind: "button", label: "Показать весь список — 105" },
      { kind: "link", label: "Все 47 уроков →" },
      { kind: "link", label: null },
    ],
    cards: [["link"]],
  };

  it("reads every digit run of a chrome label as # and leaves cards and icon items alone", () => {
    expect(maskSlotDigits(canvas)).toEqual({
      chrome: [
        { kind: "button", label: "Показать весь список — #" },
        { kind: "link", label: "Все # уроков →" },
        { kind: "link", label: null },
      ],
      cards: [["link"]],
    });
  });

  it("passes the canvas's sample count against the app's live one when the section opts in", () => {
    const app: SlotStructure = {
      chrome: [
        { kind: "button", label: "Показать весь список — 118" },
        { kind: "link", label: "Все 1204 уроков →" },
        { kind: "link", label: null },
      ],
      cards: [["link"]],
    };
    expect(diffSlots(canvas, app, { maskDigits: true })).toEqual([]);
  });

  it("RED: without the opt-in the different count is a difference", () => {
    const app: SlotStructure = {
      ...canvas,
      chrome: [
        { kind: "button", label: "Показать весь список — 118" },
        ...canvas.chrome.slice(1),
      ],
    };
    expect(diffSlots(canvas, app)).not.toEqual([]);
  });

  it("RED: a label whose WORDS differ still fails with the opt-in", () => {
    const app: SlotStructure = {
      ...canvas,
      chrome: [
        { kind: "button", label: "Показать все — 118" },
        ...canvas.chrome.slice(1),
      ],
    };
    const lines = diffSlots(canvas, app, { maskDigits: true });
    expect(lines.join(" | ")).toContain("Показать все — #");
    expect(lines.join(" | ")).toContain("Показать весь список — #");
  });
});

describe("canvas-slots · #3757 applySlotAllowlist", () => {
  const entry = {
    canvas: "page.dc.html",
    props: {},
    regions: ["contacts"],
    delta: "missing" as const,
    item: { kind: "link" as const, label: "Academy ↗" },
    decision: "test",
    source: "test",
  };
  const canvas: SlotStructure = {
    chrome: [
      { kind: "link", label: "Telegram" },
      { kind: "link", label: "Academy ↗" },
    ],
    cards: [["link"]],
  };
  const app: SlotStructure = {
    chrome: [{ kind: "link", label: "Telegram" }],
    cards: [["link"]],
  };

  it("removes a decided chrome item of the named section, then the section matches", () => {
    const decided = applySlotAllowlist(
      [entry],
      { canvas: "page.dc.html", props: {}, region: "contacts" },
      canvas,
      app,
    );
    expect(decided.stale).toEqual([]);
    expect(diffSlots(decided.canvas, decided.app)).toEqual([]);
  });

  it("does not apply an entry scoped to another section, and reports an entry that matches nothing as stale", () => {
    const other = applySlotAllowlist(
      [entry],
      { canvas: "page.dc.html", props: {}, region: "docs" },
      canvas,
      app,
    );
    expect(diffSlots(other.canvas, other.app)).not.toEqual([]);
    const stale = applySlotAllowlist(
      [entry],
      { canvas: "page.dc.html", props: {}, region: "contacts" },
      app,
      app,
    );
    expect(stale.stale).toEqual([entry]);
  });
});

/**
 * The «Профиль · Разделы» section of `account-profile.dc.html` as the runtime
 * renders it (`readRuntimeCanvasSlots`, host «витрина врача», phone
 * «подтверждён», «есть заявка») — the input the pure comparison receives.
 */
const ACCOUNT_CANVAS: SlotStructure = {
  chrome: [
    { kind: "button", label: "Изменить" },
    { kind: "button", label: "Изменить" },
    {
      kind: "link",
      label: "Пароль Сменить пароль Отправим ссылку для сброса на email →",
    },
    {
      kind: "link",
      label: "События Мои события Эфиры, записи и сертификаты →",
    },
    { kind: "link", label: "Мои заявки на Конгресс →" },
    { kind: "button", label: "Выйти из аккаунта" },
  ],
  cards: [],
};

describe("canvas-slots · a section with no repeated cards (#3758, /account)", () => {
  it("fails an app cabinet that drops the congress row or reorders sign-out (RED proof)", () => {
    const canvas = ACCOUNT_CANVAS;
    const dropped = canvas.chrome.filter((i) => !i.label?.includes("Конгресс"));
    expect(diffSlots(canvas, { chrome: dropped, cards: [] })).toEqual([
      "missing in app (chrome): link «Мои заявки на Конгресс →»",
    ]);
    const logout = canvas.chrome.at(-1)!;
    const reordered = [logout, ...canvas.chrome.slice(0, -1)];
    expect(diffSlots(canvas, { chrome: reordered, cards: [] })).not.toEqual([]);
    expect(diffSlots(canvas, { chrome: canvas.chrome, cards: [] })).toEqual([]);
  });

  it("reconciles the cabinet's code-only «Сменить пароль» helper through the one allowlist step, no stale entry", () => {
    const { entries } = JSON.parse(
      readFileSync(
        join(REPO, "packages/e2e/lib/canvas-structure-allowlist.json"),
        "utf8",
      ),
    ) as { entries: AllowlistEntry[] };
    const canvas = ACCOUNT_CANVAS;
    const app: SlotStructure = {
      chrome: canvas.chrome.map((i) =>
        i.label?.startsWith("Пароль")
          ? {
              ...i,
              label:
                "Пароль Сменить пароль Отправим код для сброса пароля на email →",
            }
          : i,
      ),
      cards: [],
    };
    expect(diffSlots(canvas, app)).not.toEqual([]);
    const where = {
      canvas: "account-profile.dc.html",
      props: {
        host: "витрина врача",
        variant: "Разделы",
        congress: "есть заявка",
      },
      region: "Профиль · Разделы",
    };
    const decided = applySlotAllowlist(entries, where, canvas, app);
    expect(decided.stale).toEqual([]);
    expect(diffSlots(decided.canvas, decided.app)).toEqual([]);
  });
});

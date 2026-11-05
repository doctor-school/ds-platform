import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  applySlotAllowlist,
  diffSlots,
  extractCanvasSlots,
  maskSlotDigits,
  type SlotStructure,
} from "./canvas-slots.js";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const DOCTOR_FEED = join(REPO, "design-source/doctor-feed.dc.html");

const quote = (s: string) => s.replace(/"/g, "&quot;");

/** A page canvas and a card canvas side by side, as in `design-source/`. */
function fixtures(page: string, pageLogic: string, card: string, cardLogic: string): string {
  const dir = mkdtempSync(join(tmpdir(), "canvas-slots-"));
  const write = (name: string, template: string, logic: string) =>
    writeFileSync(
      join(dir, name),
      `<x-dc>${template}</x-dc><script type="text/x-dc" data-dc-script data-props="${quote("{}")}">class Component extends DCLogic { ${logic} }</script>`,
    );
  write("page.dc.html", page, pageLogic);
  write("unit-card.dc.html", card, cardLogic);
  return join(dir, "page.dc.html");
}

const SPEC = { section: ["data-screen-label", "events"] as [string, string], cards: ["unit-card"] };

const PAGE = `
  <dc-import name="ds-shell" embedded="{{ true }}">
    <section data-screen-label="events">
      <a href="#">Все события →</a>
      <sc-for list="{{ items }}" as="it">
        <dc-import name="unit-card" title="{{ it.title }}" show-cta="{{ it.cta }}"></dc-import>
      </sc-for>
    </section>
  </dc-import>`;
const PAGE_LOGIC = `renderVals() { return { items: [
  { title: 'Эфир № 091', cta: true }, { title: 'Doctor Club', cta: true }, { title: 'Вебинар', cta: true } ] }; }`;
const CARD = `<div><a href="#">{{ title }}</a><sc-if value="{{ cta }}"><button>Записаться</button></sc-if></div>`;
const CARD_LOGIC = `renderVals() { return { title: this.props.title, cta: this.props.showCta }; }`;

describe("canvas-slots · extractCanvasSlots", () => {
  it("cuts at the ds-shell import, expands each card import with camelCased props, and keeps chrome by label, cards by kind sequence", () => {
    const file = fixtures(PAGE, PAGE_LOGIC, CARD, CARD_LOGIC);
    expect(extractCanvasSlots(file, {}, SPEC)).toEqual({
      chrome: [{ kind: "link", label: "Все события →" }],
      cards: [
        ["link", "button"],
        ["link", "button"],
        ["link", "button"],
      ],
    });
  });

  it("renders a design-system component a card mounts through the caller's renderer", () => {
    const file = fixtures(
      PAGE,
      PAGE_LOGIC,
      `<div><x-import component-from-global-scope="DsDesignSystem.Card" dc-props="{{ card }}"></x-import></div>`,
      `renderVals() { return { card: { title: this.props.title } }; }`,
    );
    const seen: unknown[] = [];
    const out = extractCanvasSlots(file, {}, SPEC, (name, props) => {
      seen.push([name, props]);
      return `<article><a href="/x">${String(props.title)}</a></article>`;
    });
    expect(out.cards).toEqual([["link"], ["link"], ["link"]]);
    expect(seen[0]).toEqual(["Card", { title: "Эфир № 091" }]);
  });

  it("refuses a design-system component without a renderer instead of reading it as empty", () => {
    const file = fixtures(
      PAGE,
      PAGE_LOGIC,
      `<x-import component-from-global-scope="DsDesignSystem.Card" dc-props="{{ {} }}"></x-import>`,
      `renderVals() { return {}; }`,
    );
    expect(() => extractCanvasSlots(file, {}, SPEC)).toThrow(/needs a component renderer/);
  });

  it("reads the vendored doctor-feed events section: one chrome link and one shape per sample event", () => {
    const out = extractCanvasSlots(
      DOCTOR_FEED,
      { props: { loggedIn: false } },
      { section: ["data-screen-label", "d-feed · события"], cards: ["unit-event-card"] },
      (name, props) => {
        expect(name).toBe("WebinarCard");
        return `<div data-webinar-card><a href="${String(props.href)}">${String(props.title)}</a></div>`;
      },
    );
    expect(out.chrome).toEqual([{ kind: "link", label: "Все события по специальности →" }]);
    expect(out.cards.length).toBeGreaterThan(0);
    expect(new Set(out.cards.map((c) => c.join()))).toEqual(new Set(["link"]));
  });
});

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
    ).toEqual(["card shape: app [link] on 2 card(s) — the canvas draws [link · button]"]);
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

describe("canvas-slots · #3757 repeats (sc-for iterations as cards)", () => {
  const PAGE_REPEATS = `
    <dc-import name="ds-shell" embedded="{{ true }}">
      <section data-screen-label="catalog">
        <input placeholder="Начните вводить название">
        <div>
          <sc-for list="{{ tiles }}" as="t"><a href="#">{{ t }}</a></sc-for>
        </div>
        <sc-for list="{{ rows }}" as="row">
          <sc-if value="{{ row.ready }}"><a href="#">{{ row.title }}</a></sc-if>
          <sc-if value="{{ !row.ready }}"><div>{{ row.title }}</div><button>Сообщить</button></sc-if>
        </sc-for>
        <button>Показать весь список — 105 ▾</button>
      </section>
    </dc-import>`;
  const LOGIC = `renderVals() { return { tiles: ['Терапия', 'Педиатрия', 'Другое'],
    rows: [{ title: 'Политика', ready: true }, { title: 'Оферта', ready: false }] }; }`;

  it("reads each iteration of a listed alias as one card, its elements together; the rest stays chrome", () => {
    const file = fixtures(PAGE_REPEATS, LOGIC, "<div></div>", "");
    const slots = extractCanvasSlots(
      file,
      {},
      {
        section: ["data-screen-label", "catalog"],
        repeats: ["t", "row"],
      },
    );
    expect(slots.chrome).toEqual([
      { kind: "input", label: "Начните вводить название" },
      { kind: "button", label: "Показать весь список — 105 ▾" },
    ]);
    expect(slots.cards).toEqual([
      ["link"],
      ["link"],
      ["link"],
      ["link"],
      ["button"],
    ]);
  });

  it("keeps an unlisted alias's controls in the chrome by label", () => {
    const file = fixtures(PAGE_REPEATS, LOGIC, "<div></div>", "");
    const slots = extractCanvasSlots(
      file,
      {},
      {
        section: ["data-screen-label", "catalog"],
        repeats: ["row"],
      },
    );
    expect(slots.chrome.map((i) => i.label)).toEqual([
      "Начните вводить название",
      "Терапия",
      "Педиатрия",
      "Другое",
      "Показать весь список — 105 ▾",
    ]);
    expect(slots.cards).toEqual([["link"], ["button"]]);
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

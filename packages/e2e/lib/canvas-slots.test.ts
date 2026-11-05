import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { diffSlots, extractCanvasSlots, type SlotStructure } from "./canvas-slots.js";

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

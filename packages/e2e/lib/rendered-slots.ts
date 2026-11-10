import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { expect, type BrowserContext, type Page } from "@playwright/test";

import {
  applySlotAllowlist,
  diffSlots,
  type CardShapeEntry,
  formatSlots,
  slotSectionRoot,
  type SlotSectionSpec,
  type SlotStructure,
} from "./canvas-slots.js";
import type {
  AllowlistEntry,
  ItemKind,
  StructureItem,
} from "./canvas-structure.js";
import { openRuntimeCanvas } from "./canvas-runtime.js";

/**
 * #3728 — the repeated-slot check (`./canvas-slots.ts`) read the SAME way on
 * both sides: the visible controls of one section, split into its chrome
 * (outside every card, kind + visible label) and one kind sequence per card.
 * The app side is the rendered page; the canvas side (#3798) is the vendored
 * page canvas rendered by the real Claude Design runtime
 * (`./canvas-runtime.ts`, offline, in the spec's own browser context) — card
 * imports, `sc-for` iterations and DS components (`DsDesignSystem.*`, from the
 * DS bundle built from this repo) are what the runtime drew, not a sandbox
 * interpretation of the template.
 */

export interface RenderedSlotSection {
  /** The section root, e.g. `[data-testid="specialty-feed-events"]`. */
  root: string;
  /** One repeated card's root, e.g. `[data-webinar-card]`; absent = a chrome-only section. */
  card?: string;
  /**
   * Card roots carrying the same value of this attribute are ONE card (an
   * `sc-for` iteration that draws several sibling elements). Absent = every
   * `card` match is its own card.
   */
  group?: string;
}

const ALLOWLIST = JSON.parse(
  readFileSync(
    new URL("./canvas-structure-allowlist.json", import.meta.url),
    "utf8",
  ),
) as { entries: AllowlistEntry[]; cardShapes?: CardShapeEntry[] };

export async function readRenderedSlots(
  page: Page,
  region: RenderedSlotSection,
): Promise<SlotStructure> {
  const read = await page.evaluate(({ root, card, group }) => {
    const KIND: Record<string, string> = {
      A: "link",
      BUTTON: "button",
      INPUT: "input",
      SUMMARY: "summary",
    };
    const section = document.querySelector(root);
    if (!section) throw new Error(`no section ${root}`);
    const collapse = (t: string) => t.replace(/\s+/g, " ").trim();
    // Labels are read as AUTHORED on both sides — a `text-transform`
    // («← ДОКУМЕНТЫ» #3757, the cabinet's uppercase row eyebrows «ПАРОЛЬ»
    // #3758) is styling, not the label.
    const authored = document.createElement("style");
    authored.textContent = "* { text-transform: none !important; }";
    document.head.append(authored);
    const roots = card ? [...section.querySelectorAll(card)] : [];
    const keys: string[] = [];
    const keyOf = roots.map((c, i) => {
      const key = group ? (c.getAttribute(group) ?? String(i)) : String(i);
      if (!keys.includes(key)) keys.push(key);
      return key;
    });
    const shapes: string[][] = keys.map(() => []);
    const chrome: { kind: string; label: string | null }[] = [];
    for (const el of section.querySelectorAll("a, button, input, summary")) {
      const box = el.getBoundingClientRect();
      const shown =
        el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
        box.width > 1 &&
        box.height > 1 &&
        !el.closest('[aria-hidden="true"]');
      if (!shown) continue;
      if (el.parentElement?.closest("a, button, summary")) continue;
      const kind = KIND[el.tagName]!;
      const at = roots.findIndex((c) => c === el || c.contains(el));
      if (at !== -1) {
        shapes[keys.indexOf(keyOf[at]!)]!.push(kind);
        continue;
      }
      let label: string | null;
      if (el.tagName === "INPUT") {
        label = collapse(el.getAttribute("placeholder") ?? "") || null;
      } else {
        // `innerText` (#3758) keeps a separator between block children — the
        // cabinet row «Пароль» / «Сменить пароль» / helper reads as spaced
        // words — and drops hidden text as rendering does.
        const text = collapse((el as HTMLElement).innerText ?? "");
        label = /[\p{L}\p{N}]/u.test(text) ? text : null;
      }
      chrome.push({ kind, label });
    }
    authored.remove();
    return { chrome, cards: shapes };
  }, region);
  return {
    chrome: read.chrome as StructureItem[],
    cards: read.cards as ItemKind[][],
  };
}

/** The attribute the canvas side marks its card roots with (value = card number). */
const CARD_MARK = "data-canvas-slot-card";

/**
 * Mark the cards of one section of a runtime-rendered canvas page with
 * `CARD_MARK`: every `spec.cards` import host (`[data-sc-name="<name>"]`, the
 * runtime's `dc-import` element), and every iteration of a `spec.repeats`
 * `sc-for` alias — found through the runtime's annotated template
 * (`__dcAnnotatedTemplate`): the rendered elements whose `data-dc-tpl` is a
 * direct child of that `sc-for`, one card per iteration. Returns the section
 * root selector.
 */
async function markCanvasCards(
  page: Page,
  spec: SlotSectionSpec,
): Promise<string> {
  const { root } = slotSectionRoot(spec);
  await page.evaluate(
    ({ root, cards, repeats, mark }) => {
      const section = document.querySelector(root);
      if (!section) throw new Error(`no canvas section ${root}`);
      let n = 0;
      for (const name of cards) {
        for (const host of section.querySelectorAll(
          `[data-sc-name="${name}"]`,
        )) {
          host.setAttribute(mark, String(n++));
        }
      }
      if (repeats.length === 0) return;
      const dc = window as unknown as {
        __dcAnnotatedTemplate(name: string): string;
        __dcRootName(): string;
      };
      const tpl = document.createElement("template");
      tpl.innerHTML = dc.__dcAnnotatedTemplate(dc.__dcRootName());
      // The section's own template is the one its nearest component host draws.
      const scope = section.closest("[data-sc-name]");
      const own = (el: Element) =>
        el.parentElement?.closest("[data-sc-name]") === scope;
      for (const alias of repeats) {
        const loops = [
          ...tpl.content.querySelectorAll(`sc-for[as="${alias}"]`),
        ];
        if (loops.length === 0)
          throw new Error(`no <sc-for as="${alias}"> in the canvas template`);
        for (const loop of loops) {
          // The elements one iteration draws: the loop's children, through
          // the control-flow tags that draw no element of their own.
          const drawn = (el: Element): string[] =>
            el.localName === "sc-if" || el.localName === "sc-for"
              ? [...el.children].flatMap(drawn)
              : [el.getAttribute("data-dc-tpl") ?? ""].filter(Boolean);
          const ids = [...loop.children].flatMap(drawn);
          const rendered = [
            ...section.querySelectorAll("[data-dc-tpl]"),
          ].filter(
            (el) => ids.includes(el.getAttribute("data-dc-tpl")!) && own(el),
          );
          // Template order within one iteration; a step back opens the next one.
          let current = -1;
          let last = Infinity;
          for (const el of rendered) {
            const at = ids.indexOf(el.getAttribute("data-dc-tpl")!);
            if (at <= last) current = n++;
            last = at;
            el.setAttribute(mark, String(current));
          }
        }
      }
    },
    {
      root,
      cards: spec.cards ?? [],
      repeats: spec.repeats ?? [],
      mark: CARD_MARK,
    },
  );
  return root;
}

/** The canvas side: one section of `canvas` rendered by the runtime with `props`, read. */
export async function readRuntimeCanvasSlots(
  context: BrowserContext,
  canvas: string,
  props: Record<string, unknown>,
  spec: SlotSectionSpec,
): Promise<SlotStructure> {
  const { ready } = slotSectionRoot(spec);
  const runtime = await openRuntimeCanvas(context, canvas, {
    props,
    ...(ready ? { ready } : {}),
  });
  try {
    const root = await markCanvasCards(runtime.page, spec);
    return await readRenderedSlots(runtime.page, {
      root,
      card: `[${CARD_MARK}]`,
      group: CARD_MARK,
    });
  } finally {
    await runtime.close();
  }
}

/**
 * Assert one rendered repeated-card section against a page canvas: chrome by
 * kind + label, cards by shape only (`diffSlots`). The canvas's mobile branch
 * is its own media query on the context's viewport.
 */
export async function expectSlotSectionMatchesCanvas(
  page: Page,
  options: {
    canvas: string;
    props?: Record<string, unknown>;
    section: SlotSectionSpec;
    rendered: RenderedSlotSection;
  },
): Promise<void> {
  const props = options.props ?? {};
  const fromCanvas = await readRuntimeCanvasSlots(
    page.context(),
    options.canvas,
    props,
    options.section,
  );
  const fromApp = await readRenderedSlots(page, options.rendered);
  // #3757 / #3770 — the section's decided chrome deviations and card shapes
  // (`canvas-structure-allowlist.json` `entries` / `cardShapes`, `regions` =
  // the section's attribute value), stale entries reported.
  const decided = applySlotAllowlist(
    ALLOWLIST.entries,
    {
      canvas: basename(options.canvas),
      props,
      region: slotSectionRoot(options.section).region,
    },
    fromCanvas,
    fromApp,
    ALLOWLIST.cardShapes ?? [],
  );
  const lines = [
    ...decided.stale.map((entry) =>
      "item" in entry
        ? `stale allowlist entry (${entry.delta}): ${entry.item.kind} «${entry.item.label ?? "icon"}» — ${entry.source}`
        : `stale card-shape entry: canvas [${entry.canvasShape.join(" · ")}] → app [${entry.appShape.join(" · ")}] — ${entry.source}`,
    ),
    ...diffSlots(decided.canvas, decided.app, {
      maskDigits: options.section.maskDigits,
    }),
  ];
  const report = lines.length
    ? [
        `${options.canvas} ${JSON.stringify(props)} section ${slotSectionRoot(options.section).region} ≠ rendered ${options.rendered.root}:`,
        ...lines.map((l) => `  - ${l}`),
        "canvas:",
        formatSlots(fromCanvas).replace(/^/gm, "  "),
        "app:",
        formatSlots(fromApp).replace(/^/gm, "  "),
      ].join("\n")
    : null;
  expect(report, report ?? "").toBeNull();
}

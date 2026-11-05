import { expect, type Page } from "@playwright/test";

import {
  diffSlots,
  extractCanvasSlots,
  formatSlots,
  type RenderComponent,
  type SlotSectionSpec,
  type SlotStructure,
} from "./canvas-slots.js";
import type { CanvasInput, ItemKind, StructureItem } from "./canvas-structure.js";
import { canvasPath } from "./rendered-structure.js";

/**
 * #3728 — the APP half of the repeated-slot check (`./canvas-slots.ts`): the
 * visible controls of one rendered section, split into its chrome (outside
 * every card, kind + visible label) and one kind sequence per card root.
 */

export interface RenderedSlotSection {
  /** The section root, e.g. `[data-testid="specialty-feed-events"]`. */
  root: string;
  /** One repeated card's root, e.g. `[data-webinar-card]`. */
  card: string;
}

export async function readRenderedSlots(
  page: Page,
  region: RenderedSlotSection,
): Promise<SlotStructure> {
  const read = await page.evaluate(({ root, card }) => {
    const KIND: Record<string, string> = {
      A: "link",
      BUTTON: "button",
      INPUT: "input",
      SUMMARY: "summary",
    };
    const section = document.querySelector(root);
    if (!section) throw new Error(`no section ${root}`);
    const collapse = (t: string) => t.replace(/\s+/g, " ").trim();
    const cards = [...section.querySelectorAll(card)];
    const shapes: string[][] = cards.map(() => []);
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
      const at = cards.findIndex((c) => c.contains(el));
      if (at !== -1) {
        shapes[at]!.push(kind);
        continue;
      }
      let label: string | null;
      if (el.tagName === "INPUT") {
        label = collapse(el.getAttribute("placeholder") ?? "") || null;
      } else {
        const text = collapse((el as HTMLElement).innerText ?? "");
        label = /[\p{L}\p{N}]/u.test(text) ? text : null;
      }
      chrome.push({ kind, label });
    }
    return { chrome, cards: shapes };
  }, region);
  return {
    chrome: read.chrome as StructureItem[],
    cards: read.cards as ItemKind[][],
  };
}

/**
 * Assert one rendered repeated-card section against a page canvas: chrome by
 * kind + label, cards by shape only (`diffSlots`).
 */
export async function expectSlotSectionMatchesCanvas(
  page: Page,
  options: {
    canvas: string;
    input: CanvasInput;
    section: SlotSectionSpec;
    rendered: RenderedSlotSection;
    renderComponent?: RenderComponent;
  },
): Promise<void> {
  const fromCanvas = extractCanvasSlots(
    canvasPath(options.canvas),
    options.input,
    options.section,
    options.renderComponent,
  );
  const fromApp = await readRenderedSlots(page, options.rendered);
  const lines = diffSlots(fromCanvas, fromApp);
  const report = lines.length
    ? [
        `${options.canvas} ${JSON.stringify(options.input.props ?? {})} section ${options.section.section[1]} ≠ rendered ${options.rendered.root}:`,
        ...lines.map((l) => `  - ${l}`),
        "canvas:",
        formatSlots(fromCanvas).replace(/^/gm, "  "),
        "app:",
        formatSlots(fromApp).replace(/^/gm, "  "),
      ].join("\n")
    : null;
  expect(report, report ?? "").toBeNull();
}

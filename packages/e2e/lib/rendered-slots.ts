import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { expect, type Page } from "@playwright/test";

import {
  applySlotAllowlist,
  diffSlots,
  extractCanvasSlots,
  formatSlots,
  type RenderComponent,
  type SlotSectionSpec,
  type SlotStructure,
} from "./canvas-slots.js";
import type {
  AllowlistEntry,
  CanvasInput,
  ItemKind,
  StructureItem,
} from "./canvas-structure.js";
import { canvasPath } from "./rendered-structure.js";

const ALLOWLIST = JSON.parse(
  readFileSync(
    new URL("./canvas-structure-allowlist.json", import.meta.url),
    "utf8",
  ),
) as { entries: AllowlistEntry[] };

/**
 * #3728 — the APP half of the repeated-slot check (`./canvas-slots.ts`): the
 * visible controls of one rendered section, split into its chrome (outside
 * every card, kind + visible label) and one kind sequence per card root.
 */

export interface RenderedSlotSection {
  /** The section root, e.g. `[data-testid="specialty-feed-events"]`. */
  root: string;
  /** One repeated card's root, e.g. `[data-webinar-card]`; absent = a chrome-only section. */
  card?: string;
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
    // #3758: labels are read as AUTHORED — the canvas tokenizer reads template
    // text, not CSS — so a `text-transform` (the cabinet's uppercase row
    // eyebrows «ПАРОЛЬ») must not leak into `innerText` for the read.
    const authored = document.createElement("style");
    authored.textContent = "* { text-transform: none !important; }";
    document.head.append(authored);
    try {
      const cards = card ? [...section.querySelectorAll(card)] : [];
      const shapes: string[][] = cards.map(() => []);
      const chrome: { kind: string; label: string | null }[] = [];
      for (const el of section.querySelectorAll("a, button, input, summary")) {
        const box = el.getBoundingClientRect();
        const shown =
          el.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
          }) &&
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
          // `innerText` (#3758) keeps a separator between block children — the
          // cabinet row «Пароль» / «Сменить пароль» / helper reads as the canvas
          // tokenizer's spaced words — and drops hidden text as rendering does;
          // the `authored` style above keeps CSS `text-transform` («← ДОКУМЕНТЫ»,
          // #3757) out of it.
          const text = collapse((el as HTMLElement).innerText ?? "");
          label = /[\p{L}\p{N}]/u.test(text) ? text : null;
        }
        chrome.push({ kind, label });
      }
      return { chrome, cards: shapes };
    } finally {
      authored.remove();
    }
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
  // #3757 — the section's decided chrome deviations (`canvas-structure-allowlist.json`,
  // `regions` = the section's attribute value), stale entries reported.
  const decided = applySlotAllowlist(
    ALLOWLIST.entries,
    {
      canvas: basename(options.canvas),
      props: options.input.props ?? {},
      region: options.section.section[1],
    },
    fromCanvas,
    fromApp,
  );
  const lines = [
    ...decided.stale.map(
      (entry) =>
        `stale allowlist entry (${entry.delta}): ${entry.item.kind} «${entry.item.label ?? "icon"}» — ${entry.source}`,
    ),
    ...diffSlots(decided.canvas, decided.app, {
      maskDigits: options.section.maskDigits,
    }),
  ];
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

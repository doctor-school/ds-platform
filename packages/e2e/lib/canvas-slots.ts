import { basename, dirname, resolve } from "node:path";

import {
  diffStructures,
  itemKindOf,
  parseTemplate,
  resolveCanvas,
  visibleLabelOf,
  type CanvasInput,
  type ItemKind,
  type ResolvedElement,
  type ResolvedNode,
  type StructureItem,
} from "./canvas-structure.js";

/**
 * #3728 — the canvas-structure check on a DATA page: a section that repeats
 * one card per data item. The header rule (`diffStructures`: every item by
 * kind + visible label, count and order) cannot apply there — the canvas
 * draws hard-coded SAMPLE items (three lessons, «Эфир № 091»), and their
 * titles and count are data, not layout. So a section is read in two parts:
 *
 * - **chrome** — the section's own controls outside any card («Все события
 *   по специальности →»): compared as the header is, by kind + visible label;
 * - **cards** — each repeated item reduced to its SHAPE, the kind sequence of
 *   its controls (`link · button`), with no label and no count. Every card
 *   shape the app renders must be one the canvas draws, and the app must
 *   render at least one card where the canvas draws them.
 *
 * That catches the #3629 class on a data page — a control moved out of the
 * cards into the chrome (or back), a control missing from every card, a card
 * drawn as a different component — and never compares sample data.
 *
 * Region cut: the page canvas wraps its content in `<dc-import name="ds-shell">`;
 * that import is NOT expanded (the shell is the header check's region,
 * `./rendered-structure.ts`) — its slot children are the page. A card import
 * (`dc-import name="unit-event-card"`) IS expanded: the imported canvas is
 * evaluated with the import's props (kebab attributes → camelCase props, the
 * DC runtime's mapping), because the card's controls live there. A design-
 * system component a canvas mounts (`<x-import component-from-global-scope=
 * "DsDesignSystem.WebinarCard" dc-props="{{ card }}">`) is rendered by the
 * caller's `renderComponent` — the DS bundle the canvas loads is not vendored
 * (design-source/README.md), so the repository's `@ds/design-system` export of
 * the same name stands for it.
 */

export interface SlotSectionSpec {
  /** The canvas section: an element whose attribute has this value. */
  section: [attr: string, value: string];
  /** `dc-import` names that are one repeated card each. */
  cards: string[];
}

export interface SlotStructure {
  chrome: StructureItem[];
  /** One kind sequence per card, in document order. */
  cards: ItemKind[][];
}

/** Server-render one design-system component to static HTML. */
export type RenderComponent = (name: string, props: Record<string, unknown>) => string;

const camel = (name: string) => name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());

function findSection(nodes: ResolvedNode[], [attr, value]: [string, string]): ResolvedElement | null {
  for (const node of nodes) {
    if (node.type !== "el") continue;
    if (node.attrs[attr] === value) return node;
    const inner = findSection(node.children, [attr, value]);
    if (inner) return inner;
  }
  return null;
}

interface Ctx {
  file: string;
  render: RenderComponent | undefined;
}

/** The controls under `nodes`, imports and DS components expanded. */
function controls(nodes: ResolvedNode[], ctx: Ctx, out: StructureItem[]): void {
  for (const node of nodes) {
    if (node.type !== "el") continue;
    if (node.tag === "dc-import") {
      out.push(...importedControls(node, ctx));
      continue;
    }
    if (node.tag === "x-import") {
      out.push(...componentControls(node, ctx));
      continue;
    }
    const kind = itemKindOf(node.tag);
    if (kind) {
      out.push({ kind, label: visibleLabelOf(node) });
      continue;
    }
    controls(node.children, ctx, out);
  }
}

function importedControls(node: ResolvedElement, ctx: Ctx): StructureItem[] {
  const name = String(node.attrs.name);
  const file = resolve(dirname(ctx.file), `${name}.dc.html`);
  const props = Object.fromEntries(
    Object.entries(node.attrs)
      .filter(([k]) => k !== "name")
      .map(([k, v]) => [camel(k), v]),
  );
  const out: StructureItem[] = [];
  controls(resolveCanvas(file, { props }), { ...ctx, file }, out);
  return out;
}

function componentControls(node: ResolvedElement, ctx: Ctx): StructureItem[] {
  const global = String(node.attrs["component-from-global-scope"] ?? "");
  const name = global.replace(/^DsDesignSystem\./, "");
  if (!ctx.render || name === global) {
    throw new Error(
      `${basename(ctx.file)}: <x-import component-from-global-scope="${global}"> needs a component renderer`,
    );
  }
  const props = (node.attrs["dc-props"] ?? {}) as Record<string, unknown>;
  const out: StructureItem[] = [];
  // Static markup parses with the canvas tokenizer; it has no `{{ }}` left.
  controls(parseTemplate(ctx.render(name, props)) as ResolvedNode[], ctx, out);
  return out;
}

function split(
  nodes: ResolvedNode[],
  spec: SlotSectionSpec,
  ctx: Ctx,
  out: SlotStructure,
): void {
  for (const node of nodes) {
    if (node.type !== "el") continue;
    if (node.tag === "dc-import" && spec.cards.includes(String(node.attrs.name))) {
      out.cards.push(importedControls(node, ctx).map((i) => i.kind));
      continue;
    }
    if (node.tag === "dc-import" || node.tag === "x-import") {
      controls([node], ctx, out.chrome);
      continue;
    }
    const kind = itemKindOf(node.tag);
    if (kind) {
      out.chrome.push({ kind, label: visibleLabelOf(node) });
      continue;
    }
    split(node.children, spec, ctx, out);
  }
}

/** The chrome + card shapes of one repeated-card section of a page canvas. */
export function extractCanvasSlots(
  file: string,
  input: CanvasInput,
  spec: SlotSectionSpec,
  render?: RenderComponent,
): SlotStructure {
  const section = findSection(resolveCanvas(file, input), spec.section);
  if (!section) {
    throw new Error(`${basename(file)}: no section [${spec.section[0]}="${spec.section[1]}"]`);
  }
  const out: SlotStructure = { chrome: [], cards: [] };
  split(section.children, spec, { file, render }, out);
  return out;
}

const shapeKey = (shape: ItemKind[]) => `[${shape.join(" · ") || "no controls"}]`;

/**
 * Readable differences, empty when the section matches: chrome as the header
 * (missing / extra / order), cards by shape only — counts and labels of the
 * repeated items are never compared.
 */
export function diffSlots(canvas: SlotStructure, app: SlotStructure): string[] {
  const lines = diffStructures(
    { bar: canvas.chrome, menu: [] },
    { bar: app.chrome, menu: [] },
  ).map((line) => line.replace("(bar)", "(chrome)"));
  if (canvas.cards.length > 0 && app.cards.length === 0) {
    lines.push("cards: the canvas repeats cards here, the app renders none");
  }
  const drawn = new Set(canvas.cards.map(shapeKey));
  const seen = new Map<string, number>();
  for (const shape of app.cards) {
    const key = shapeKey(shape);
    if (!drawn.has(key)) seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, n] of seen) {
    lines.push(
      `card shape: app ${key} on ${n} card(s) — the canvas draws ${[...drawn].join(", ") || "none"}`,
    );
  }
  return lines;
}

export function formatSlots(slots: SlotStructure): string {
  const chrome = slots.chrome.map((i) => `${i.kind} «${i.label ?? "icon"}»`).join(" · ");
  const shapes = [...new Set(slots.cards.map(shapeKey))].join(", ");
  return `chrome: ${chrome || "—"}\ncards: ${slots.cards.length} · shapes ${shapes || "—"}`;
}

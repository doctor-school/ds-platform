import {
  applyAllowlist,
  diffStructures,
  type AllowlistEntry,
  type ItemKind,
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
 * Both sides are read by the same browser reader (`./rendered-slots.ts`): the
 * canvas as the real Claude Design runtime renders it (#3798) — a card import
 * (`dc-import name="unit-event-card"`) is the runtime's import host, a DS
 * component a card mounts (`DsDesignSystem.WebinarCard`) is the DS bundle
 * built from this repo, and the page's `dc-import name="ds-shell"` is outside
 * every section (the shell is the header check's region,
 * `./rendered-structure.ts`).
 */

export interface SlotSectionSpec {
  /**
   * The canvas section: an element whose attribute has this value (the
   * canvas's `data-screen-label`), or — #3890, a canvas that labels no screen
   * (`account-my-events.dc.html`) — a CSS selector that is unique in it,
   * with the name a screen label would give it (`label`, the allowlist
   * region: one per screen the spec reads, e.g. the canvas's mobile branch).
   */
  section: [attr: string, value: string] | { selector: string; label: string };
  /** `dc-import` names that are one repeated card each (the runtime's `[data-sc-name]` hosts). */
  cards?: string[];
  /**
   * #3757 — `sc-for` aliases (`as`) whose every iteration is one repeated card
   * although no card import draws it (the catalog's chips, a list's rows):
   * the elements one iteration produced (the `data-dc-tpl` of the loop's
   * direct children) are read as that card's controls.
   */
  repeats?: string[];
  /**
   * #3757 — the section's chrome labels carry a live count («Показать весь
   * список — N», «Все 47 уроков →»): every digit run is read as `#` on BOTH
   * sides, so the canvas's sample number never fails the app's real one,
   * while a label whose WORDS differ still does.
   */
  maskDigits?: boolean;
}

/**
 * #3890 — where a section spec points in the runtime-rendered canvas: its
 * `root` selector, the `region` its allowlist entries are scoped by (the
 * attribute value, or the selector's `label`), and what the render waits for
 * (`ready`; undefined = the runtime's default, a screen label under
 * `#dc-root`, which a canvas that labels no screen never draws).
 */
export function slotSectionRoot(spec: Pick<SlotSectionSpec, "section">): {
  root: string;
  region: string;
  ready: string | undefined;
} {
  if (Array.isArray(spec.section)) {
    const [attr, value] = spec.section;
    return { root: `[${attr}="${value}"]`, region: value, ready: undefined };
  }
  const { selector, label } = spec.section;
  return { root: selector, region: label, ready: `#dc-root ${selector}` };
}

export interface SlotStructure {
  chrome: StructureItem[];
  /** One kind sequence per card, in document order. */
  cards: ItemKind[][];
}

const shapeKey = (shape: ItemKind[]) =>
  `[${shape.join(" · ") || "no controls"}]`;

/**
 * Readable differences, empty when the section matches: chrome as the header
 * (missing / extra / order), cards by shape only — counts and labels of the
 * repeated items are never compared.
 */
export function diffSlots(
  canvas: SlotStructure,
  app: SlotStructure,
  options: { maskDigits?: boolean | undefined } = {},
): string[] {
  if (options.maskDigits) {
    canvas = maskSlotDigits(canvas);
    app = maskSlotDigits(app);
  }
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
  const chrome = slots.chrome
    .map((i) => `${i.kind} «${i.label ?? "icon"}»`)
    .join(" · ");
  const shapes = [...new Set(slots.cards.map(shapeKey))].join(", ");
  return `chrome: ${chrome || "—"}\ncards: ${slots.cards.length} · shapes ${shapes || "—"}`;
}

const DIGIT_RUN = /\p{Nd}+/gu;

/** #3757 — every digit run of a chrome label read as `#` (`SlotSectionSpec.maskDigits`). */
export function maskSlotDigits(slots: SlotStructure): SlotStructure {
  return {
    chrome: slots.chrome.map((item) =>
      item.label === null
        ? item
        : { ...item, label: item.label.replace(DIGIT_RUN, "#") },
    ),
    cards: slots.cards,
  };
}

/**
 * #3770 — one decided difference of a section's card SHAPE: the app draws
 * every card the canvas draws as `canvas` as `app` instead (the home catalog's
 * chips: the canvas's placeholder `<a href="#">`, the app's command `<button>`,
 * 017 EARS-6). Scoped and cited as an `AllowlistEntry`; the card's other
 * controls and the card count stay compared.
 */
export interface CardShapeEntry {
  canvas: string;
  props: Record<string, unknown>;
  /** The section attribute values it applies to; absent = every section. */
  regions?: string[];
  /** The shape the canvas draws. */
  canvasShape: ItemKind[];
  /** The decided shape the app renders in its place. */
  appShape: ItemKind[];
  decision: string;
  source: string;
}

function applies(
  entry: { canvas: string; props: Record<string, unknown>; regions?: string[] },
  where: { canvas: string; props: Record<string, unknown>; region: string },
): boolean {
  return (
    entry.canvas === where.canvas &&
    Object.entries(entry.props).every(([k, v]) => where.props[k] === v) &&
    (!entry.regions || entry.regions.includes(where.region))
  );
}

/**
 * #3757 / #3770 — the decided deviations of one section removed before
 * `diffSlots`: its CHROME items by `applyAllowlist` (the header's allowlist
 * and semantics: one item per entry, `regions` scoped by the section's
 * attribute value), and its decided card SHAPES (`CardShapeEntry`): every app
 * card of the decided shape is read as the canvas shape it replaces — only
 * where the canvas draws that shape, so a canvas redraw retires the entry. An
 * applicable entry that matches nothing is returned as `stale`.
 */
export function applySlotAllowlist(
  entries: AllowlistEntry[],
  where: { canvas: string; props: Record<string, unknown>; region: string },
  canvas: SlotStructure,
  app: SlotStructure,
  cardShapes: CardShapeEntry[] = [],
): {
  canvas: SlotStructure;
  app: SlotStructure;
  stale: (AllowlistEntry | CardShapeEntry)[];
} {
  const decided = applyAllowlist(
    entries,
    where,
    { bar: canvas.chrome, menu: [] },
    { bar: app.chrome, menu: [] },
  );
  const stale: (AllowlistEntry | CardShapeEntry)[] = [...decided.stale];
  let cards = app.cards;
  const drawn = new Set(canvas.cards.map(shapeKey));
  for (const entry of cardShapes) {
    if (!applies(entry, where)) continue;
    const from = shapeKey(entry.appShape);
    if (
      !drawn.has(shapeKey(entry.canvasShape)) ||
      !cards.some((shape) => shapeKey(shape) === from)
    ) {
      stale.push(entry);
      continue;
    }
    cards = cards.map((shape) =>
      shapeKey(shape) === from ? [...entry.canvasShape] : shape,
    );
  }
  return {
    canvas: { chrome: decided.canvas.bar, cards: canvas.cards },
    app: { chrome: decided.app.bar, cards },
    stale,
  };
}

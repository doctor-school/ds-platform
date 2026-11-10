/**
 * #3682 — the structural canvas-parity check, its comparison half: the
 * semantic tree both sides are read into, the diff, and the allowlist of
 * decided deviations. Both trees are read by the SAME browser reader — the
 * rendered app page, and the vendored canvas (`design-source/*.dc.html`) as
 * the real Claude Design runtime renders it (`./canvas-runtime.ts`, #3793 /
 * #3798; readers in `./rendered-structure.ts` and `./rendered-slots.ts`).
 *
 * The tree is deliberately small: the interactive items (`a`, `button`,
 * `input`, `summary`), each with its kind and VISIBLE label, split into `bar`
 * (visible with every menu closed) and `menu` (what the `≡` toggle reveals).
 * An icon- or image-only control (no letter or digit in its visible text)
 * compares by kind alone — its glyph, image alt and tooltip / aria wording are
 * not drawn, so they are not layout.
 */

export type ItemKind = "link" | "button" | "input" | "summary";

export interface StructureItem {
  kind: ItemKind;
  /** Visible label; `null` for an icon-only control. */
  label: string | null;
}

export interface RegionStructure {
  bar: StructureItem[];
  menu: StructureItem[];
}

// ── comparison ──────────────────────────────────────────────────────────────

function keyOf(item: StructureItem): string {
  return `${item.kind} «${item.label ?? "icon"}»`;
}

function without(list: string[], key: string): string[] {
  const at = list.indexOf(key);
  return at === -1 ? list : [...list.slice(0, at), ...list.slice(at + 1)];
}

/**
 * Readable differences between the canvas tree and the app tree; empty when
 * they match. Each line names one of: missing, extra, wrong container, order.
 */
export function diffStructures(
  canvas: RegionStructure,
  app: RegionStructure,
): string[] {
  const lines: string[] = [];
  const other = { bar: "menu", menu: "bar" } as const;
  for (const container of ["bar", "menu"] as const) {
    const want = canvas[container].map(keyOf);
    const have = app[container].map(keyOf);
    let unmatchedHave = [...have];
    const common: string[] = [];
    for (const key of want) {
      if (unmatchedHave.includes(key)) {
        unmatchedHave = without(unmatchedHave, key);
        common.push(key);
      } else if (app[other[container]].map(keyOf).includes(key)) {
        lines.push(
          `wrong container: ${key} — canvas ${container}, app ${other[container]}`,
        );
      } else {
        lines.push(`missing in app (${container}): ${key}`);
      }
    }
    // An occurrence the other container lacks was already reported as «wrong
    // container» from that side; only that many are suppressed here.
    const count = (keys: string[], key: string) =>
      keys.filter((k) => k === key).length;
    const wantOther = canvas[other[container]].map(keyOf);
    const haveOther = app[other[container]].map(keyOf);
    const suppressed = new Map<string, number>();
    for (const key of unmatchedHave) {
      const lacking = Math.max(
        0,
        count(wantOther, key) - count(haveOther, key),
      );
      const used = suppressed.get(key) ?? 0;
      if (used < lacking) {
        suppressed.set(key, used + 1);
        continue;
      }
      lines.push(`extra in app (${container}): ${key}`);
    }
    // Order over the items both sides have in this container.
    let pool = [...common];
    const appOrder = have.filter((key) => {
      if (!pool.includes(key)) return false;
      pool = without(pool, key);
      return true;
    });
    if (appOrder.join("|") !== common.join("|")) {
      lines.push(
        `order (${container}): canvas [${common.join(", ")}] · app [${appOrder.join(", ")}]`,
      );
    }
  }
  return lines;
}

export function formatStructure(structure: RegionStructure): string {
  return (["bar", "menu"] as const)
    .map((c) => `${c}: ${structure[c].map(keyOf).join(" · ") || "—"}`)
    .join("\n");
}

// ── allowlist of decided deviations ─────────────────────────────────────────

export interface AllowlistEntry {
  /** Canvas file name, e.g. `ds-shell.dc.html`. */
  canvas: string;
  /** Applies when every listed prop equals the evaluated canvas prop. */
  props: Record<string, unknown>;
  /** Applies only to these regions (a region's or section's name); absent = every region. */
  regions?: string[];
  /** `missing`: the canvas draws it, the app decidedly does not. `extra`: the reverse. */
  delta: "missing" | "extra";
  item: StructureItem;
  /**
   * #3892 — the item's label is the signed-in account's DATA (an initials
   * chip), so the entry names its shape instead: a Unicode regex the whole
   * label must match, in place of `item.label`. Still one item per entry.
   */
  labelPattern?: string;
  /** The recorded decision, in one line. */
  decision: string;
  /** Where the decision is recorded (spec path, PR). */
  source: string;
}

function sameItem(a: StructureItem, b: StructureItem): boolean {
  return a.kind === b.kind && a.label === b.label;
}

function entryMatches(item: StructureItem, entry: AllowlistEntry): boolean {
  if (entry.labelPattern === undefined) return sameItem(item, entry.item);
  return (
    item.kind === entry.item.kind &&
    item.label !== null &&
    new RegExp(`^(?:${entry.labelPattern})$`, "u").test(item.label)
  );
}

/**
 * Remove the decided deviations from both trees before {@link diffStructures}.
 * An applicable entry that matches nothing is returned as `stale` — a decision
 * the code no longer needs must leave the allowlist, not linger as cover.
 */
export function applyAllowlist(
  entries: AllowlistEntry[],
  where: {
    canvas: string;
    props: Record<string, unknown>;
    region?: string | undefined;
  },
  canvas: RegionStructure,
  app: RegionStructure,
): { canvas: RegionStructure; app: RegionStructure; stale: AllowlistEntry[] } {
  const next = {
    canvas: { bar: [...canvas.bar], menu: [...canvas.menu] },
    app: { bar: [...app.bar], menu: [...app.menu] },
  };
  const stale: AllowlistEntry[] = [];
  for (const entry of entries) {
    if (entry.canvas !== where.canvas) continue;
    if (!Object.entries(entry.props).every(([k, v]) => where.props[k] === v))
      continue;
    if (
      entry.regions &&
      !(where.region && entry.regions.includes(where.region))
    )
      continue;
    const side = entry.delta === "missing" ? next.canvas : next.app;
    // An entry is ONE decided item: it removes one occurrence, so an unlabelled
    // `icon` entry (the signed-in avatar) leaves the other icon links in place.
    // Equal items pair left to right with the other side, so the unpaired,
    // decided occurrence is the TRAILING one (the logo icon leads every bar).
    let hit = false;
    for (const container of ["bar", "menu"] as const) {
      const items = side[container];
      let at = items.length - 1;
      while (at >= 0 && !entryMatches(items[at]!, entry)) at -= 1;
      if (at === -1) continue;
      side[container] = items.filter((_, i) => i !== at);
      hit = true;
      break;
    }
    if (!hit) stale.push(entry);
  }
  return { ...next, stale };
}

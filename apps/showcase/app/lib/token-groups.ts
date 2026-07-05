import manifest from "@ds/design-system/allowed-tokens.json";

/**
 * Token-class grouping for the showcase Tokens section (design-system-showcase
 * spec §3.1). The **only** input is the generated manifest
 * (`@ds/design-system/allowed-tokens.json`) — the same SoT the lint guardrails
 * read (#234). Token NAMES come from the manifest here; their VALUES are read at
 * render time from the compiled CSS custom properties (`getComputedStyle`, see
 * `tokens-view.tsx`) — so the page cannot drift from the token build, and a token
 * added to the package surfaces here automatically.
 *
 * The one exception is breakpoints: they are emitted as literal `@theme inline`
 * values, never as `:root` runtime vars (a `var()` is invalid inside the
 * `@media` query they drive), so `getComputedStyle` cannot read them. Their
 * values therefore come from the manifest's own `breakpoints` array — still the
 * generated SoT, never hardcoded here.
 */

/** How a specimen for a group renders (drives the visual in `tokens-view.tsx`). */
export type TokenSpecimenKind =
  | "color"
  | "fontFamily"
  | "fontSize"
  | "fontWeight"
  | "lineHeight"
  | "letterSpacing"
  | "textRole"
  | "space"
  | "radius"
  | "size"
  | "border"
  | "shadow"
  | "duration"
  | "easing"
  | "zIndex"
  | "opacity"
  | "breakpoint"
  | "value";

export interface TokenEntry {
  /** The CSS custom-property name, e.g. `--color-primary`. */
  name: string;
  /** Short label: the name minus its group prefix, e.g. `primary`. */
  label: string;
  /**
   * A value known at build time (breakpoints only — not a `:root` var). Every
   * other group leaves this undefined and reads the live computed value.
   */
  staticValue?: string;
  /** The primitive this token aliases (`--color-card` → `--color-white`), if any. */
  reference?: string;
  /** Usage note from the token source `$description`, if any. */
  description?: string;
}

export interface TokenGroup {
  id: string;
  title: string;
  description: string;
  kind: TokenSpecimenKind;
  tokens: TokenEntry[];
  /** Also read+show the `.dark` value (semantic colours diverge by theme). */
  showDark?: boolean;
}

/**
 * Palette primitive vs semantic role. A colour is a **palette primitive** if it
 * is `white`/`black` or a `<scale>-<step>` ramp entry (`blue-500`,
 * `neutral-100`, `neutral-alpha-10`, …). Everything else under `--color-` is a
 * **semantic role** (`background`, `card`, `primary`, `accent-foreground`, …)
 * that references a primitive — which is why semantic tokens resolve to the same
 * light-mode value as a palette swatch, yet diverge by theme.
 */
function isPaletteColor(label: string): boolean {
  return /^(white|black)$/.test(label) || /^(blue|neutral|green|orange|red)-/.test(label);
}

/** Ordered classifiers — each `:root` var falls into the FIRST one it matches. */
const CLASSIFIERS: {
  id: string;
  title: string;
  description: string;
  kind: TokenSpecimenKind;
  match: (name: string) => boolean;
  /** Strip the group prefix for the per-token label. */
  label: (name: string) => string;
  showDark?: boolean;
}[] = [
  {
    id: "color-palette",
    title: "Color · palette (primitives)",
    description:
      "The raw colour ramps — the single source the semantic roles below reference.",
    kind: "color",
    match: (n) =>
      n.startsWith("--color-") && isPaletteColor(n.slice("--color-".length)),
    label: (n) => n.slice("--color-".length),
  },
  {
    id: "color-semantic",
    title: "Color · semantic roles",
    description:
      "Role tokens that reference a palette primitive. They share a palette value in light mode (so a swatch can look like a duplicate) but carry distinct meaning and DIVERGE by theme — the dark value is shown alongside.",
    kind: "color",
    showDark: true,
    match: (n) => n.startsWith("--color-"),
    label: (n) => n.slice("--color-".length),
  },
  {
    id: "font-family",
    title: "Typography · family",
    description: "Font-family stacks.",
    kind: "fontFamily",
    match: (n) => n.startsWith("--font-family-"),
    label: (n) => n.slice("--font-family-".length),
  },
  {
    id: "font-size",
    title: "Typography · size",
    description: "The modular type scale.",
    kind: "fontSize",
    match: (n) => n.startsWith("--font-size-"),
    label: (n) => n.slice("--font-size-".length),
  },
  {
    id: "font-weight",
    title: "Typography · weight",
    description: "Font weights.",
    kind: "fontWeight",
    match: (n) => n.startsWith("--font-weight-"),
    label: (n) => n.slice("--font-weight-".length),
  },
  {
    id: "line-height",
    title: "Typography · line-height",
    description: "Leading scale.",
    kind: "lineHeight",
    match: (n) => n.startsWith("--font-line-height-"),
    label: (n) => n.slice("--font-line-height-".length),
  },
  {
    id: "letter-spacing",
    title: "Typography · letter-spacing",
    description: "Tracking scale.",
    kind: "letterSpacing",
    match: (n) => n.startsWith("--font-letter-spacing-"),
    label: (n) => n.slice("--font-letter-spacing-".length),
  },
  {
    id: "text-role",
    title: "Typography · text roles",
    description: "Composite body / heading / label roles (size + leading + weight).",
    kind: "textRole",
    match: (n) => n.startsWith("--text-"),
    label: (n) => n.slice("--text-".length),
  },
  {
    id: "space",
    title: "Spacing",
    description: "The spacing scale that drives padding, gap and margin.",
    kind: "space",
    match: (n) => n.startsWith("--space-"),
    label: (n) => n.slice("--space-".length),
  },
  {
    id: "radius",
    title: "Radius",
    description: "Corner radii — the base scale and per-component radii.",
    kind: "radius",
    // Both the scale (`--radius-base`, `--radius-control`) and the per-component
    // radii (`--button-radius`, `--card-radius`, …).
    match: (n) => n.startsWith("--radius-") || n.endsWith("radius"),
    label: (n) =>
      n
        .replace(/^--/, "")
        .replace(/^radius-/, "")
        .replace(/-?radius$/, ""),
  },
  {
    id: "border-width",
    title: "Border width",
    description: "Stroke widths.",
    kind: "border",
    match: (n) => n.startsWith("--border-width-"),
    label: (n) => n.slice("--border-width-".length),
  },
  {
    id: "shadow",
    title: "Shadow / elevation",
    description: "Elevation shadows.",
    kind: "shadow",
    match: (n) => n.startsWith("--shadow-"),
    label: (n) => n.slice("--shadow-".length),
  },
  {
    id: "duration",
    title: "Motion · duration",
    description: "Transition / animation durations.",
    kind: "duration",
    match: (n) => n.includes("duration"),
    label: (n) => n.replace(/^--(motion-)?duration-/, ""),
  },
  {
    id: "easing",
    title: "Motion · easing",
    description: "Easing curves.",
    kind: "easing",
    match: (n) => n.includes("easing"),
    label: (n) => n.replace(/^--(motion-)?easing-/, ""),
  },
  {
    id: "z-index",
    title: "Z-index",
    description: "Stacking-order scale.",
    kind: "zIndex",
    match: (n) => n.startsWith("--z-index-"),
    label: (n) => n.slice("--z-index-".length),
  },
  {
    id: "opacity",
    title: "Opacity",
    description: "Opacity scale.",
    kind: "opacity",
    match: (n) => n.startsWith("--opacity-"),
    label: (n) => n.slice("--opacity-".length),
  },
  {
    id: "size",
    title: "Component sizes",
    description: "Fixed component dimensions.",
    kind: "size",
    match: (n) => n.endsWith("size"),
    label: (n) => n.replace(/^--/, "").replace(/-?size$/, ""),
  },
  {
    id: "layout",
    title: "Layout — container & gutter",
    description:
      "The page-shell contract (#514, canvas §09): the content/calendar container max-widths and the fluid/mobile page gutters. Paired with the `desktop` breakpoint below.",
    kind: "value",
    match: (n) => n.startsWith("--layout-"),
    label: (n) => n.slice("--layout-".length),
  },
];

/**
 * Build the ordered token groups from the manifest. Anything in `cssVariables`
 * that no classifier claims lands in a visible "Uncategorized" group, so a new
 * token class can never silently vanish — it shows up loudly instead.
 */
export function buildTokenGroups(): TokenGroup[] {
  const cssVariables: string[] = manifest.cssVariables ?? [];
  const breakpoints: { name: string; value: string }[] =
    manifest.breakpoints ?? [];
  const references: Record<string, string> = manifest.references ?? {};
  const descriptions: Record<string, string> = manifest.descriptions ?? {};

  const groups: TokenGroup[] = CLASSIFIERS.map((c) => ({
    id: c.id,
    title: c.title,
    description: c.description,
    kind: c.kind,
    tokens: [] as TokenEntry[],
    ...(c.showDark ? { showDark: true } : {}),
  }));
  const uncategorized: TokenEntry[] = [];

  for (const name of cssVariables) {
    const idx = CLASSIFIERS.findIndex((c) => c.match(name));
    if (idx === -1) {
      uncategorized.push({ name, label: name });
      continue;
    }
    const group = groups[idx]!;
    group.tokens.push({
      name,
      label: CLASSIFIERS[idx]!.label(name),
      ...(references[name] ? { reference: references[name] } : {}),
      ...(descriptions[name] ? { description: descriptions[name] } : {}),
    });
  }

  // Breakpoints — values from the manifest (see file header).
  groups.push({
    id: "breakpoint",
    title: "Breakpoints",
    description: "Responsive width thresholds (literal @theme values).",
    kind: "breakpoint",
    tokens: breakpoints.map((b) => ({
      name: b.name,
      label: b.name.slice("--breakpoint-".length),
      staticValue: b.value,
    })),
  });

  if (uncategorized.length > 0) {
    groups.push({
      id: "uncategorized",
      title: "Uncategorized",
      description:
        "Tokens no classifier claimed — surfaced loudly so a new token class is never lost.",
      kind: "value",
      tokens: uncategorized,
    });
  }

  // Drop empty classifier groups (e.g. if a class is ever removed upstream).
  return groups.filter((g) => g.tokens.length > 0);
}

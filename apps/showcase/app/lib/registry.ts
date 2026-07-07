/**
 * Showcase registry (design-system-showcase spec §7 — "the seam between what the
 * package exports and what is catalogued"). This is the single declarative list of
 * the `@ds/design-system` units the showcase catalogues, and the surface the
 * **coverage guard** (`tools/lint/showcase-coverage-lint.ts`, §5.1) reads to assert
 * the viewer never silently lags the system. The candidate/adopted seam (§4, #349)
 * and deliverable A render INTO this registry; keeping it one declarative array is
 * what lets the guard, the seam, and deliverable A stay decoupled (§7).
 *
 * SELF-CONTAINED BY CONTRACT. This module MUST NOT import any value or type from
 * `@ds/design-system` (or anything that transitively imports the package): the
 * coverage guard `import()`s it from an arbitrary directory (its `LINT_FIXTURE_ROOT`
 * seam) with no module resolution beyond Node built-ins, so a package import would
 * make the registry undiscoverable from a fixture tree. The entry shape is therefore
 * a LOCAL interface, not a package type.
 *
 * GRANULARITY (the rule the guard derives its required set from, mirrored here):
 *   - A single-file primitive subpath (`./button`, `./card`, `./input`, `./input-otp`,
 *     `./label`, `./link`, `./tabs`, `./form`) is ONE unit, id = the subpath basename.
 *     Its sub-components (CardHeader, FormControl, TabsList, InputOTPGroup, …) are NOT
 *     separate units — they are catalogued under their parent primitive.
 *   - The multi-component subpaths `./fields` and `./blocks` each expand to their
 *     individual COMPONENT named exports (one unit per component); their non-component
 *     exports (schemas, mask helpers, hooks, types) are deliberately not catalogued —
 *     see {@link NON_CATALOGUED_EXPORTS}.
 *
 * Tokens (spec §3.1) are catalogued from the generated token manifest, not from a
 * component export, so the coverage guard's required set is COMPONENT-only; the
 * `tokens` section below is seeded for completeness of the viewer's own navigation,
 * not because the guard requires it.
 */

/** One catalogued showcase unit — the subject of a showcase section entry. */
export interface ShowcaseEntry {
  /** Stable unit id. For a primitive subpath this is the basename (`button`); for a
   *  `fields`/`blocks` component it is the exported component name (`EmailField`). */
  id: string;
  /** Which showcase section catalogues the unit. */
  section: "tokens" | "primitives" | "blocks";
}

/**
 * The catalogued inventory. Grows with the system; the coverage guard fails when a
 * `@ds/design-system` component export has no entry here.
 */
export const SHOWCASE_REGISTRY: ShowcaseEntry[] = [
  // ── Tokens (spec §3.1) — catalogued from the generated manifest, one entry to
  //    register the section with the viewer (not part of the guard's required set).
  { id: "tokens", section: "tokens" },

  // ── Primitives (spec §3.2) — single-file primitive subpaths, one unit each.
  { id: "button", section: "primitives" },
  { id: "card", section: "primitives" },
  { id: "input", section: "primitives" },
  { id: "input-otp", section: "primitives" },
  { id: "label", section: "primitives" },
  { id: "link", section: "primitives" },
  { id: "tabs", section: "primitives" },
  { id: "form", section: "primitives" },

  // ── New-language primitives (spec §3.2, #513) — single-file primitive subpaths.
  { id: "filter-chip", section: "primitives" },
  { id: "badge", section: "primitives" },
  { id: "avatar", section: "primitives" },
  { id: "checkbox", section: "primitives" },
  { id: "radio", section: "primitives" },
  { id: "switch", section: "primitives" },
  { id: "alert", section: "primitives" },
  { id: "skeleton", section: "primitives" },
  { id: "day-band", section: "primitives" },

  // ── Listing unit (004 EARS-8, #557) — the webinar-card.dc.html §09 unit.
  { id: "webinar-card", section: "primitives" },

  // ── Event-page content set (004 EARS-2, #551) — the webinar-page.dc.html body.
  { id: "webinar-page-content", section: "primitives" },

  // ── Event-page status card (004 EARS-4, #553) — the lifecycle status swap.
  { id: "webinar-status-card", section: "primitives" },

  // ── Layout primitive (spec §3.2, #514) — the §09 content-column container.
  { id: "container", section: "primitives" },

  // ── Field primitives (spec §3.2, the `fields/*` set) — `./fields` components.
  { id: "EmailField", section: "primitives" },
  { id: "PhoneField", section: "primitives" },
  { id: "OtpField", section: "primitives" },
  { id: "PasswordField", section: "primitives" },
  { id: "IdentifierField", section: "primitives" },

  // ── Blocks (spec §3.3) — `./blocks` components.
  { id: "AuthCard", section: "blocks" },
  { id: "AuthLayout", section: "blocks" },
  { id: "OtpFocusScreen", section: "blocks" },
];

/**
 * Package exports deliberately NOT catalogued as visual showcase units — the
 * conscious, surfaced record of the granularity choice so the gap is a documented
 * decision, not a silent omission (the coverage guard references this list in its
 * header). These are non-visual helpers / schemas / hooks / class-composition
 * fragments: they have no rendered look and no state matrix to show.
 */
export const NON_CATALOGUED_EXPORTS: string[] = [
  // class-composition + interaction-state fragments (barrel `.` exports)
  "cn",
  "interactiveBase",
  // `./fields` non-component exports (zod resolver fragments + mask helper)
  "EmailFieldSchema",
  "PhoneFieldSchema",
  "IdentifierFieldSchema",
  "OtpCodeFieldSchema",
  "NewPasswordFieldSchema",
  "CurrentPasswordFieldSchema",
  "maskPhoneInput",
  // `./blocks` non-component exports (resend countdown hook + mask helper)
  "useResendCountdown",
  "maskDestination",
];

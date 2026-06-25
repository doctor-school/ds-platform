#!/usr/bin/env tsx
/**
 * tools/lint/interaction-states-lint.ts — enforcement gate for the
 * "interaction-state & motion quality contract" (ADR-0013 §7, tech-spec §3.3,
 * epic #270 layer 3, child #269).
 *
 * Why this exists: the #237 auth slice shipped clickables with an arrow cursor,
 * no hover feedback, and no audit — the contract lived as prose and never fired
 * at the primitive layer. ADR-0013 §7 makes interaction quality a *layered*
 * guarantee; this is **layer 3**, the static guard that catches what the global
 * base-reset (layer 1) and the per-primitive contract (layer 2) are supposed to
 * provide, so a regression can't merge silently.
 *
 * What it checks — THREE things, matching the layered model:
 *
 *  (a) **Layer-1 integrity** in `packages/design-system/src/styles/globals.css`:
 *      the `@layer base` interaction-state reset must still be present —
 *      `cursor: pointer` on the interactive element list (incl. `button` +
 *      `[role="button"]`), `cursor: not-allowed` for `:disabled` /
 *      `[aria-disabled="true"]`, and the `prefers-reduced-motion` guard. This is
 *      the "by default" layer every clickable relies on; if it is deleted, every
 *      clickable silently degrades again. Cursor is owned HERE, globally — it is
 *      deliberately NOT re-checked per primitive (layer 1 covers it once).
 *
 *  (b) **Clickable-primitive state contract** in
 *      `packages/design-system/src/primitives/*`: every styled clickable
 *      primitive (a `button` element, `role="button"`, or a Radix `*.Trigger`)
 *      must declare, in its own classes, a **hover affordance** (`hover:*`) and
 *      a **visible keyboard focus** — the latter satisfied either by a literal
 *      `focus-visible:*` class or by composing the shared `interactiveBase`
 *      fragment (which carries the focus-visible ring). `cursor-pointer` is NOT
 *      required per primitive — layer 1 owns it globally.
 *
 *  (c) **App-level "no raw styled text link"** in `apps/<app>/{app,components,
 *      src}/**` (.tsx, real UI source — tests / e2e / stories excluded): an
 *      app-level text link MUST route through the `@ds/design-system` `Link`
 *      primitive (which carries hover + focus + the brand-anchored colour once),
 *      not be a raw `<a className=…>` or a bare `next/link` `<Link className=…>`
 *      carrying its own styling. This is the gap that let the portal footer ship
 *      `<Link className="underline">` with NO hover state through green CI (the
 *      2026-06-25 live review, finding #3). The contract for the link row of the
 *      interaction-state matrix is owned in ONE primitive, so the app-layer rule
 *      is the inverse: "don't hand-roll a styled link" rather than "re-declare
 *      hover/focus on every app link" (Option B of #325 — states live once, the
 *      guard enforces no-raw-link, which is reliably checkable with static
 *      analysis). The legitimate composition pattern — `<Link asChild><NextLink
 *      href=…>…</NextLink></Link>` or `<Button asChild><NextLink…>` — is allowed:
 *      the inner `next/link` carries NO `className` (the DS primitive owns the
 *      styling), so a raw `next/link` is only flagged when it itself carries the
 *      styling. A bare unstyled `<a href>` / `<Link href>` (no `className`) is
 *      also fine — it inherits the layer-1 reset and declares no bespoke look.
 *
 * The shared `interactive-base.ts` fragment is itself validated to still carry
 * `focus-visible:` — if that fragment loses the ring, every primitive composing
 * it loses focus, so the fragment is the one place worth a direct assertion.
 *
 * Scope is intentionally narrow + literal so the gate is reliable, not a style
 * nanny: only STYLED clickables are enforced (a bare `asChild` Radix Trigger
 * re-export with no utility classes carries no contract of its own and is
 * skipped). Inputs, labels, cards, and other non-clickable primitives are out of
 * scope — hover is not a contract for a text field.
 *
 * Suppression: a clickable may carry `/* interaction-states-ok: <reason> *\/` to
 * acknowledge an intentional exception (rare). The reason is required.
 *
 * Severity: WARN in Phase 0 (ADR-0007 §2.6: new AI-specific guards land as WARN,
 * promote to BLOCK once stable), consistent with `registry-research` / `no-stub`.
 * The CI job uses `continue-on-error`.
 *
 * Run: `pnpm lint:interaction-states`. Violations: stderr + exit 1. Clean: exit 0.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";

// TEST SEAM: `LINT_FIXTURE_ROOT` lets the guard-tests harness point the scan at a
// fixture tree (tools/lint/guard-tests). Inert in production — when unset the root
// resolves to the repo root exactly as before, so runtime behaviour is unchanged.
const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[interaction-states]";

const GLOBALS_CSS = "packages/design-system/src/styles/globals.css";
const INTERACTIVE_BASE = "packages/design-system/src/primitives/interactive-base.ts";
const PRIMITIVE_GLOBS = ["packages/design-system/src/primitives/**/*.{ts,tsx}"];
const PRIMITIVE_IGNORE = [
  "**/*.test.{ts,tsx}",
  "**/*.spec.{ts,tsx}",
  "**/*.stories.{ts,tsx}",
  "**/interactive-base.ts", // the fragment itself — validated separately
];

// App-level UI source: the real screen/component .tsx, NOT tests / e2e / stories
// / generated output. Scoped to `app/`, `components/`, `src/` so we only scan
// rendered UI — config, scripts, and `__tests__/` are excluded. The `e2e/`
// exclusion mirrors the #314 / #309 registry-research exemption (app E2E is test
// code, not UI source).
//
// Surface scope = the PRODUCT apps that consume `@ds/design-system` (portal /
// promo / admin), matching the registry-research guard's `UI_PATH_RE`. `apps/docs`
// (Fumadocs), `apps/cms`/`apps/docs-cms` (Payload/Keystatic) and `apps/mobile`
// (React Native — no DOM `<a>`/`next/link`) are deliberately NOT scanned: they do
// not depend on the DS `Link` primitive and theme off their own host framework
// (Fumadocs `fd-*` tokens, Payload admin), so "route through the DS Link" is not
// their contract.
const APP_GLOBS = [
  "apps/portal/app/**/*.tsx",
  "apps/portal/components/**/*.tsx",
  "apps/portal/src/**/*.tsx",
  "apps/promo/app/**/*.tsx",
  "apps/promo/components/**/*.tsx",
  "apps/promo/src/**/*.tsx",
  "apps/admin/app/**/*.tsx",
  "apps/admin/components/**/*.tsx",
  "apps/admin/src/**/*.tsx",
];
const APP_IGNORE = [
  "**/*.test.{ts,tsx}",
  "**/*.spec.{ts,tsx}",
  "**/*.stories.{ts,tsx}",
  "**/__tests__/**",
  "**/e2e/**",
];

// A line/block may opt out with an explicit, reasoned acknowledgement.
const SUPPRESS_RE = /interaction-states-ok:\s*\S/;

// ── Clickable detection ──────────────────────────────────────────────────────
// A primitive is a "clickable" if it renders a native button, an element with
// role="button", or a Radix trigger. These are the affordances ADR-0013 §7
// scopes the hover/focus contract to (a text input is NOT in scope).
const CLICKABLE_SIGNALS: RegExp[] = [
  /<button[\s/>]/, // literal <button> element
  /[:=]\s*["']button["']/, // `Comp = "button"` / `as="button"` indirection
  /\brole=["']button["']/, // role="button"
  /\.Trigger\b/, // Radix `*Primitive.Trigger`
];

// A clickable is only ENFORCED if it carries its own utility classes (a real
// styled control). A bare `asChild` Trigger re-export with no classes has no
// state contract of its own — skip it rather than false-fail.
const HAS_OWN_STYLING_RE = /\bcva\s*\(|className=\{?\s*(?:cn\s*\(|["'`])/;

const HOVER_RE = /\bhover:/;
const FOCUS_VISIBLE_RE = /\bfocus-visible:/;
const USES_INTERACTIVE_BASE_RE = /\binteractiveBase\b/;

// ── App-level raw-styled-link detection (scope c) ────────────────────────────
// A raw text link in app source is a violation only when it carries its OWN
// styling — a `className` (literal or interpolated) on a raw `<a …>` element, or
// on a `next/link` `<Link …>`. The states for app text links live in the
// `@ds/design-system` `Link` primitive; a styled raw link bypasses it (defect #3).
//
// We match a single opening tag (`<a …>` / `<Link …>`, attributes up to the
// closing `>`, including a self-closing `/>`) that also carries a `className`
// attribute inside the same tag. The `[^>]*` is bounded by `>` so it cannot run
// past the element. `<Link>` here is the JSX identifier — by convention the
// `next/link` default import — while the DS primitive is imported under a
// distinct alias (`DsLink` / `Link as DsLink`); a tag named `<DsLink …>` does not
// match and is therefore allowed to carry a className (it IS the primitive).
const RAW_STYLED_ANCHOR_RE = /<a\b[^>]*\bclassName\b[^>]*>/;
const RAW_STYLED_NEXTLINK_RE = /<Link\b[^>]*\bclassName\b[^>]*>/;

/**
 * Strip JS/TS comments so a commented-out `// hover:` / `/* focus-visible: *\/`
 * can't satisfy the affordance check (the same masking the layer-1 CSS check
 * guards against). Block comments are removed wholesale; line comments only when
 * the `//` follows start-of-line or whitespace, so a `://` inside a string
 * literal (e.g. a URL) is left intact.
 */
function stripJsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

interface Violation {
  file: string;
  message: string;
}

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

// ── (a) Layer-1 integrity in globals.css ─────────────────────────────────────
function checkLayer1(violations: Violation[]): void {
  let raw: string;
  try {
    raw = read(GLOBALS_CSS);
  } catch {
    violations.push({
      file: GLOBALS_CSS,
      message:
        "design-system globals.css is missing — the layer-1 interaction-state base-reset cannot be verified (ADR-0013 §7 layer 1).",
    });
    return;
  }
  // Strip CSS block comments first — the integrity checks must see the real
  // rules, not prose. (The base-reset comment literally spells out the
  // `button { cursor: pointer }` it describes; matching that would mask a
  // deleted rule.)
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");

  const checks: { ok: boolean; message: string }[] = [
    {
      ok: /\[role="button"\]/.test(css) && /\bbutton\b[\s\S]{0,160}cursor:\s*pointer/.test(css),
      message:
        "the `cursor: pointer` reset for interactive elements (`button`, `[role=\"button\"]`, …) is missing — Tailwind v4 Preflight dropped it, so layer 1 must restore it (ADR-0013 §7 / tech-spec §3.3).",
    },
    {
      ok: /cursor:\s*not-allowed/.test(css) && /:disabled/.test(css) && /\[aria-disabled="true"\]/.test(css),
      message:
        "the `cursor: not-allowed` reset for `:disabled` / `[aria-disabled=\"true\"]` is missing from layer 1.",
    },
    {
      ok: /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/.test(css),
      message:
        "the `@media (prefers-reduced-motion: reduce)` motion guard is missing from layer 1.",
    },
  ];

  for (const c of checks) {
    if (!c.ok) violations.push({ file: GLOBALS_CSS, message: c.message });
  }
}

// ── interactiveBase fragment integrity ───────────────────────────────────────
function checkInteractiveBase(violations: Violation[]): void {
  let src: string;
  try {
    src = read(INTERACTIVE_BASE);
  } catch {
    violations.push({
      file: INTERACTIVE_BASE,
      message:
        "the shared `interactiveBase` fragment is missing — primitives composing it would lose their focus ring (ADR-0013 §7 layer 2).",
    });
    return;
  }
  if (!FOCUS_VISIBLE_RE.test(src)) {
    violations.push({
      file: INTERACTIVE_BASE,
      message:
        "the shared `interactiveBase` fragment no longer declares a `focus-visible:` ring — every primitive composing it loses its visible keyboard focus.",
    });
  }
}

// ── (b) Clickable-primitive hover + focus-visible ────────────────────────────
function checkPrimitives(violations: Violation[]): number {
  const files = fg.sync(PRIMITIVE_GLOBS, {
    cwd: REPO_ROOT,
    ignore: PRIMITIVE_IGNORE,
    absolute: false,
  });

  let enforced = 0;
  for (const file of files) {
    const raw = read(file);
    if (SUPPRESS_RE.test(raw)) continue; // suppression marker lives in a comment

    // Run the contract checks against the comment-stripped source so a
    // commented-out class can't stand in for a real affordance.
    const src = stripJsComments(raw);

    const isClickable = CLICKABLE_SIGNALS.some((re) => re.test(src));
    if (!isClickable) continue;
    if (!HAS_OWN_STYLING_RE.test(src)) continue; // unstyled re-export — no own contract
    enforced++;

    const hasHover = HOVER_RE.test(src);
    const hasFocus = FOCUS_VISIBLE_RE.test(src) || USES_INTERACTIVE_BASE_RE.test(src);

    if (!hasHover) {
      violations.push({
        file,
        message:
          "styled clickable primitive has no `hover:*` affordance — declare a token-only hover state (ADR-0013 §7 layer 2).",
      });
    }
    if (!hasFocus) {
      violations.push({
        file,
        message:
          "styled clickable primitive has no visible keyboard focus — add a `focus-visible:*` ring or compose the shared `interactiveBase` fragment (ADR-0013 §7 layer 2).",
      });
    }
  }
  return enforced;
}

// ── (c) App-level "no raw styled text link" ──────────────────────────────────
// Every raw `<a className=…>` or `next/link` `<Link className=…>` in app UI
// source is flagged: app text links must route through the `@ds/design-system`
// `Link` primitive (which owns hover + focus + the brand colour). The legitimate
// `<DsLink asChild><Link href=…>` / `<Button asChild><Link href=…>` composition
// is allowed — the inner `next/link` carries no className there.
function checkAppClickables(violations: Violation[]): number {
  const files = fg.sync(APP_GLOBS, {
    cwd: REPO_ROOT,
    ignore: APP_IGNORE,
    absolute: false,
  });

  let scanned = 0;
  for (const file of files) {
    const raw = read(file);
    if (SUPPRESS_RE.test(raw)) continue; // reasoned opt-out lives in a comment

    // Strip comments so a commented-out `<Link className=…>` example (or a
    // commented `className` token) can't trip — only live JSX is checked.
    const src = stripJsComments(raw);
    scanned++;

    if (RAW_STYLED_ANCHOR_RE.test(src)) {
      violations.push({
        file,
        message:
          "raw `<a className=…>` text link in app source — route it through the `@ds/design-system` `Link` primitive (`<Link asChild><a/NextLink …></Link>`), which owns hover + focus + the brand link colour (ADR-0013 §7 link row). A hand-styled raw anchor bypasses those states (defect #3).",
      });
    }
    if (RAW_STYLED_NEXTLINK_RE.test(src)) {
      violations.push({
        file,
        message:
          "raw `next/link` `<Link className=…>` text link in app source — wrap it with the `@ds/design-system` `Link` primitive (`<Link asChild><NextLink href=…/></Link>`) so the inner `next/link` carries the routing and the DS primitive carries hover + focus + brand colour. A bare styled `next/link` ships with no hover state (defect #3).",
      });
    }
  }
  return scanned;
}

function main(): void {
  const violations: Violation[] = [];

  checkLayer1(violations);
  checkInteractiveBase(violations);
  const enforced = checkPrimitives(violations);
  const appScanned = checkAppClickables(violations);

  if (violations.length > 0) {
    process.stderr.write(
      `${TAG} ${violations.length} interaction-state violation(s):\n`,
    );
    for (const v of violations) {
      process.stderr.write(`${TAG}   ${relative(REPO_ROOT, resolve(REPO_ROOT, v.file)).replace(/\\/g, "/")}: ${v.message}\n`);
    }
    process.stderr.write(
      `${TAG} Interaction-state contract: ADR-0013 §7 / design-system README. ` +
        `cursor is owned globally by layer 1 (globals.css), not per primitive.\n`,
    );
    process.exit(1);
  }

  info(
    `OK — layer-1 base-reset intact, interactiveBase carries focus-visible, ${enforced} styled clickable primitive(s) carry hover + focus, ${appScanned} app UI file(s) carry no raw styled text link.`,
  );
  process.exit(0);
}

main();

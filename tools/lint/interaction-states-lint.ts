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
 * What it checks — TWO things, matching the layered model:
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

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[interaction-states]";

const GLOBALS_CSS = "packages/design-system/src/styles/globals.css";
const INTERACTIVE_BASE = "packages/design-system/src/primitives/interactive-base.ts";
const PRIMITIVE_GLOBS = ["packages/design-system/src/primitives/*.{ts,tsx}"];
const PRIMITIVE_IGNORE = [
  "**/*.test.{ts,tsx}",
  "**/*.spec.{ts,tsx}",
  "**/*.stories.{ts,tsx}",
  "**/interactive-base.ts", // the fragment itself — validated separately
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
    const src = read(file);
    if (SUPPRESS_RE.test(src)) continue;

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

function main(): void {
  const violations: Violation[] = [];

  checkLayer1(violations);
  checkInteractiveBase(violations);
  const enforced = checkPrimitives(violations);

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
    `OK — layer-1 base-reset intact, interactiveBase carries focus-visible, ${enforced} styled clickable primitive(s) carry hover + focus.`,
  );
  process.exit(0);
}

main();

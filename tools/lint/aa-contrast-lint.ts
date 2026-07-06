#!/usr/bin/env tsx
/**
 * tools/lint/aa-contrast-lint.ts — static pre-filter for the AA-contrast usage rule
 * (ADR-0013 §7 "Interaction-state & motion quality contract", #402). Sits **left of**
 * the runtime `playwright-axe` tier (#351): it catches the two DETERMINISTIC,
 * statically-greppable AA anti-patterns cheaply, so they fail a fast source scan rather
 * than only an expensive browser run.
 *
 * Why this exists: when #351 retargeted the runtime axe scan onto `apps/showcase`, the
 * gate immediately caught **4 pre-existing AA-contrast / label defects** in the
 * catalogue chrome (shipped across #347 / #386 / #349) that NO static guard had caught —
 * they surfaced only because the expensive Playwright tier coincidentally pointed at the
 * surface they lived on. Two of the three anti-patterns are token-level and
 * deterministic, so they belong in a cheap static gate (the `feedback_research_backed_ui_standards`
 * lesson: UI-quality must be lint-covered, not per-element patched — here recurring as a
 * COVERAGE GAP rather than a one-off). The third defect (a bare `Input`/`InputOTP`
 * specimen without a visible `<Label>`) is genuinely runtime-only — whether a control
 * has an accessible name depends on the rendered DOM, not a source token — so it stays
 * the retargeted axe scan's job (#351). This guard is the static twin; axe is the
 * runtime backstop for everything DOM-derived.
 *
 * What it flags — THREE deterministic token-level anti-patterns:
 *
 *  (1) **Opacity-dimmed foreground text** — a `text-<token>-foreground/<NN>` utility
 *      (e.g. `text-muted-foreground/70`, `text-primary-foreground/80`,
 *      `text-foreground/60`). The AA-safe foreground token is the QUIET TIER at FULL
 *      strength (`text-muted-foreground`, #270); an opacity modifier on a foreground
 *      token is the wrong lever — it drops the text below the WCAG-AA threshold. Flagged
 *      file-wide: an occurrence is a defect wherever it appears (no element scoping
 *      needed). The fix is the full-strength quiet token, or — for white-on-fill panel
 *      sub-copy — an element `opacity-*` on the wrapper (NOT a text-colour opacity).
 *
 *  (2) **Brand-primary fill under text** — `bg-primary` (the raw brand blue `#2d84f2`),
 *      NOT `bg-primary-action` / `-hover` / `-pressed` / `-surface` / `-foreground`, on
 *      an element that ALSO carries a text utility. Small / normal-weight white text on
 *      `bg-primary` fails AA; the AA-safe emphasis fill is `bg-primary-action`
 *      (blue.700 `#114d9e`, 8.14:1) per #237. A text-LESS swatch (a tokens-view colour
 *      specimen) is fine — only flagged when a `text-*` utility is present on the SAME
 *      opening tag (the "text is rendered on the fill" signal). Element-scoped via the
 *      enclosing-tag helper, mirroring `submit-pending` / `form-error`.
 *
 *  (3) **Theme-mispaired panel foreground** — `bg-primary-surface` on an element that
 *      ALSO carries `text-primary-foreground`. The two look paired but are NOT:
 *      `primary-foreground` pairs with the ACTION fill and repoints to dark ink in
 *      `.dark` (where `primary-action` lifts to a light-blue fill), while
 *      `primary-surface` stays blue.700 in both themes — the combination renders
 *      dark-on-dark (~1.2:1) in dark theme (the #517 review blocker). The paired token
 *      is `text-primary-surface-foreground` (white in BOTH themes, 8.14:1).
 *      Element-scoped like (2).
 *
 * Out of scope by construction (the static/runtime boundary): blue.500-as-text
 * (`text-primary`) and large/bold-vs-normal weight exemptions are contrast judgements
 * that need the rendered DOM (the ≥3:1 large-text carve-out, ADR-0013 §7) — left to the
 * runtime axe tier (#351), not approximated here. This guard is the cheap pre-filter for
 * the two token-level patterns only.
 *
 * Suppression: a file may carry `/* aa-contrast-ok: <reason> *\/` to acknowledge a
 * genuine exception, mirroring `interaction-states-ok` / `form-error-ok` /
 * `submit-pending-ok`. The reason is required.
 *
 * Severity: WARN in Phase 0 (ADR-0007 §2.6: new AI-specific guards land as WARN, promote
 * to BLOCK once stable), consistent with `interaction-states` / `submit-pending` /
 * `showcase-coverage`. The CI job uses `continue-on-error`.
 *
 * Run: `pnpm lint:aa-contrast`. Violations: stderr + exit 1. Clean: exit 0.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";

// TEST SEAM: `LINT_FIXTURE_ROOT` points the scan at a fixture tree
// (tools/lint/guard-tests/fixtures/aa-contrast/<case>). Inert in production — when unset
// the root resolves to the repo root, so runtime behaviour is unchanged.
const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[aa-contrast]";

// Surface scope: the design-system primitives/blocks that own the contrast contract, the
// living showcase (apps/showcase — the surface the #351 retarget caught the 4 defects on),
// and the product apps that consume @ds/design-system (portal / promo / admin). `apps/docs`
// (Fumadocs), `apps/cms`/`apps/docs-cms` (Payload/Keystatic) and `apps/mobile` (RN) theme
// off their own host framework and do not consume these tokens, so the rule is not theirs —
// matching the `interaction-states` / `submit-pending` scope.
const SCAN_GLOBS = [
  "packages/design-system/src/**/*.tsx",
  "apps/showcase/app/**/*.tsx",
  "apps/showcase/components/**/*.tsx",
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
const SCAN_IGNORE = [
  "**/*.test.{ts,tsx}",
  "**/*.spec.{ts,tsx}",
  "**/*.stories.{ts,tsx}",
  "**/__tests__/**",
  "**/e2e/**",
];

const SUPPRESS_RE = /aa-contrast-ok:\s*\S/;

// ── (1) Opacity-dimmed foreground token ──────────────────────────────────────
// `text-<prefix>-foreground/<NN>` — the `(?:[a-z0-9]+-)*` swallows any token prefix
// (`muted-`, `primary-`, `card-`, `sidebar-accent-`, …); the bare `text-foreground/NN`
// (zero prefix) is covered too. A variant chain (`data-[state=inactive]:`, `dark:`, …)
// precedes the `text-` and is bounded out by the `\b`. The `/\d` is required, so a
// full-strength `text-muted-foreground` (no slash) never matches.
const DIMMED_FOREGROUND_RE = /\btext-(?:[a-z0-9]+-)*foreground\/\d{1,3}\b/g;

// ── (2) Brand-primary fill (text-bearing) ────────────────────────────────────
// `bg-primary` NOT followed by `-` — so the AA-safe `bg-primary-action` / `-hover` /
// `-pressed` / `-surface` / `-foreground` variants are excluded, while `bg-primary` and
// `bg-primary/<NN>` (opacity on the raw blue) match. The `\b` prevents `bg-primaryfoo`.
const RAW_PRIMARY_FILL_RE = /\bbg-primary\b(?!-)/g;
// "Text is rendered on this element" — any `text-<letter>` utility on the same opening
// tag (a colour `text-white` / `text-primary-foreground`, a size `text-sm`, or an
// alignment `text-center`). A pure colour swatch carries no `text-*` utility, so it is
// not flagged.
const TEXT_UTILITY_RE = /\btext-[a-z]/;

// ── (3) Theme-mispaired panel foreground ─────────────────────────────────────
// `bg-primary-surface` NOT followed by `-`, so a hypothetical longer variant never
// matches the fill check.
const SURFACE_FILL_RE = /\bbg-primary-surface\b(?!-)/g;
// The ACTION-pair foreground on the same opening tag. The CORRECT paired utility is
// `text-primary-surface-foreground`, which does not contain the substring
// `text-primary-foreground` (the `surface-` segment breaks it), so a word-bounded
// literal cannot false-positive on the fixed pairing.
const ACTION_FOREGROUND_ON_TAG_RE = /\btext-primary-foreground\b/;

/**
 * Strip JS/TS comments so a commented-out example (a migration note documenting the very
 * anti-pattern, e.g. tabs.tsx's "Inactive resting is the muted `text-foreground/60`")
 * can't raise a false positive. Mirrors `submit-pending` / `interaction-states`.
 */
function stripJsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

/** The opening tag enclosing position `i` (nearest `<` before → next `>` after). */
function enclosingTag(src: string, i: number): string | null {
  const start = src.lastIndexOf("<", i);
  const end = src.indexOf(">", i);
  if (start === -1 || end === -1) return null;
  return src.slice(start, end + 1);
}

interface Violation {
  file: string;
  message: string;
}

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

/** (1) every `text-*-foreground/NN` occurrence in the file. */
function checkDimmedForeground(src: string, file: string, violations: Violation[]): void {
  const seen = new Set<string>();
  for (const m of src.matchAll(DIMMED_FOREGROUND_RE)) {
    const token = m[0];
    if (seen.has(token)) continue; // one message per distinct token per file
    seen.add(token);
    violations.push({
      file,
      message:
        `opacity-dimmed foreground utility \`${token}\` — an opacity modifier on a ` +
        "foreground token drops it below WCAG-AA. The AA-safe quiet tier is " +
        "`text-muted-foreground` at FULL strength (#270); for white-on-fill panel " +
        "sub-copy use an element `opacity-*` on the wrapper, not a text-colour opacity " +
        "(ADR-0013 §7).",
    });
  }
}

/** (2) `bg-primary` (non-`-action`) on a tag that also carries a text utility. */
function checkRawPrimaryFill(src: string, file: string, violations: Violation[]): void {
  const seen = new Set<number>();
  for (const m of src.matchAll(RAW_PRIMARY_FILL_RE)) {
    const tag = enclosingTag(src, m.index ?? 0);
    if (!tag) continue;
    if (!TEXT_UTILITY_RE.test(tag)) continue; // text-less swatch — fine
    // De-dup multiple bg-primary matches inside the same tag.
    const start = src.lastIndexOf("<", m.index ?? 0);
    if (seen.has(start)) continue;
    seen.add(start);
    violations.push({
      file,
      message:
        "text-bearing `bg-primary` fill (raw brand blue `#2d84f2`) — small / normal-weight " +
        "text on it fails AA. The AA-safe emphasis fill is `bg-primary-action` (blue.700 " +
        "`#114d9e`, 8.14:1, #237); a text-less colour swatch is exempt (ADR-0013 §7).",
    });
  }
}

/** (3) `bg-primary-surface` on a tag that also carries the ACTION-pair foreground. */
function checkMispairedSurfaceForeground(
  src: string,
  file: string,
  violations: Violation[],
): void {
  const seen = new Set<number>();
  for (const m of src.matchAll(SURFACE_FILL_RE)) {
    const tag = enclosingTag(src, m.index ?? 0);
    if (!tag) continue;
    if (!ACTION_FOREGROUND_ON_TAG_RE.test(tag)) continue;
    const start = src.lastIndexOf("<", m.index ?? 0);
    if (seen.has(start)) continue;
    seen.add(start);
    violations.push({
      file,
      message:
        "theme-mispaired `bg-primary-surface` + `text-primary-foreground` — " +
        "`primary-foreground` pairs with the ACTION fill and repoints to dark ink in " +
        "`.dark`, while `primary-surface` stays blue.700 in both themes, so the copy " +
        "renders dark-on-dark (~1.2:1) in dark theme (#517). Use the paired " +
        "`text-primary-surface-foreground` (white in BOTH themes, 8.14:1).",
    });
  }
}

function scan(violations: Violation[]): number {
  const files = fg.sync(SCAN_GLOBS, {
    cwd: REPO_ROOT,
    ignore: SCAN_IGNORE,
    absolute: false,
  });

  let scanned = 0;
  for (const file of files) {
    const raw = readFileSync(resolve(REPO_ROOT, file), "utf8");
    if (SUPPRESS_RE.test(raw)) continue; // reasoned opt-out lives in a comment
    const src = stripJsComments(raw);
    scanned++;

    checkDimmedForeground(src, file, violations);
    checkRawPrimaryFill(src, file, violations);
    checkMispairedSurfaceForeground(src, file, violations);
  }
  return scanned;
}

function main(): void {
  const violations: Violation[] = [];
  const scanned = scan(violations);

  if (violations.length > 0) {
    process.stderr.write(`${TAG} ${violations.length} AA-contrast violation(s):\n`);
    for (const v of violations) {
      process.stderr.write(
        `${TAG}   ${relative(REPO_ROOT, resolve(REPO_ROOT, v.file)).replace(/\\/g, "/")}: ${v.message}\n`,
      );
    }
    process.stderr.write(
      `${TAG} The AA-contrast usage rule is owned by ADR-0013 §7. This static guard is ` +
        "the cheap pre-filter; the runtime axe scan (#351) is the backstop. For a genuine " +
        "exception add /* aa-contrast-ok: <reason> */.\n",
    );
    process.exit(1);
  }

  info(
    `OK — ${scanned} UI file(s) carry no opacity-dimmed foreground, text-bearing bg-primary, or mispaired primary-surface foreground.`,
  );
  process.exit(0);
}

main();

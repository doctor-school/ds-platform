#!/usr/bin/env tsx
/**
 * tools/lint/form-rhythm-lint.ts — enforcement gate for the settled form
 * vertical-rhythm + error-state contract (ADR-0013 §7 "Form layout & validation
 * contract", #333 redo; child guard #334).
 *
 * Why this exists: the #333 Stage-B owner review found three form-quality defects
 * that every prior gate missed because each is a VALID token combination, so the
 * colour / arbitrary-value / interaction-states guards all pass:
 *
 *   K-1  an always-empty RESERVED message slot under a resting field (the slice-B
 *        `min-h-5` blank line) — over-spaces every form. The settled rule is
 *        "no reserved line": the message renders on demand, a field with neither
 *        helper nor error renders NOTHING (form.tsx FormMessage returns null).
 *   dup  a DUPLICATE `formDescriptionId` — the PasswordField rendered a separate
 *        `<FormDescription>` AND a `<FormMessage>`, which both claim
 *        `formDescriptionId` in the resting state (invalid HTML / ambiguous
 *        `aria-describedby`). The fix folds the helper into FormMessage's
 *        children (one element, one id).
 *   K-3  a DESTRUCTIVE label in the error state — label + helper + message all red
 *        ("red mush"). The settled rule marks the field (input border + focus ring
 *        + message); the LABEL STAYS NEUTRAL.
 *
 * The `@ds/design-system` form primitives (form.tsx + fields/*) are IN scope here
 * (unlike form-error-lint, which excludes the package): K-1/dup/K-3 are exactly
 * what those primitives must obey, and form.test.tsx already unit-asserts them at
 * runtime — this guard is the static, no-React regression net for the same rules,
 * across both the primitives and the app surfaces that compose forms.
 *
 * What it flags (each a precise, low-false-positive signal):
 *   A. a `min-h-*` reserved height on a form-MESSAGE element (a `<FormMessage>` /
 *      `<FormDescription>` / `<FormError>` tag, or any tag carrying `role="alert"`
 *      or a message tone token) — a message must reserve no height (K-1).
 *   B. a duplicate description id — either `<FormDescription>` AND `<FormMessage>`
 *      used in the SAME file (they collide on `formDescriptionId`), or two literal
 *      `id={formDescriptionId}` assignments in one file.
 *   C. a `text-destructive` token in the opening tag of a LABEL element
 *      (`<FormLabel>` / `<Label>` / `<label>`) — the label must stay neutral (K-3).
 *
 * Suppression: a file may carry `/* form-rhythm-ok: <reason> *\/` to acknowledge a
 * genuine exception, mirroring `form-error-ok` / `interaction-states-ok`. The
 * reason is required.
 *
 * Severity: WARN in Phase 0 (ADR-0007 §2.6) — same shape as `form-error` (#339)
 * and `interaction-states` (#269); the CI job uses `continue-on-error`. Promote
 * to BLOCK once stable.
 *
 * Run: `pnpm lint:form-rhythm`. Violations: stderr + exit 1. Clean: exit 0.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";

// TEST SEAM: `LINT_FIXTURE_ROOT` points the scan at a fixture tree
// (tools/lint/guard-tests/fixtures/form-rhythm/<case>). Inert in production — when
// unset the root resolves to the repo root, so runtime behaviour is unchanged.
const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[form-rhythm]";

// The design-system form primitives (the SSOT that must obey the contract) plus
// the product apps that compose forms from them. `apps/docs` (Fumadocs),
// `apps/cms` (Payload), `apps/mobile` (RN) theme off their own host and do not
// consume the DS form primitives, so the contract is not theirs.
const SCAN_GLOBS = [
  "packages/design-system/src/primitives/**/*.tsx",
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

const SUPPRESS_RE = /form-rhythm-ok:\s*\S/;

const MIN_H_RE = /min-h-/g;
const TEXT_DESTRUCTIVE = "text-destructive";
const LABEL_TAGS = /^<\s*(FormLabel|Label|label)\b/;
const MESSAGE_TAGS = /^<\s*(FormMessage|FormDescription|FormError)\b/;
const FORM_DESCRIPTION_USE = /<\s*FormDescription\b/;
const FORM_MESSAGE_USE = /<\s*FormMessage\b/;
const DESCRIPTION_ID_ASSIGN = /id=\{\s*formDescriptionId\s*\}/g;

/**
 * Strip JS/TS comments so a commented-out example (a migration note) can't raise a
 * false positive. Mirrors `form-error-lint.ts` / `interaction-states-lint.ts`.
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

/** Is this opening tag a form-message element (the slot that must not reserve height)? */
function isMessageTag(tag: string): boolean {
  return (
    MESSAGE_TAGS.test(tag) ||
    /role=["']alert["']/.test(tag) ||
    /text-muted-foreground/.test(tag) ||
    new RegExp(TEXT_DESTRUCTIVE).test(tag)
  );
}

interface Violation {
  file: string;
  message: string;
}

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

/** A. `min-h-*` on a form-message element (K-1 reserved blank line). */
function checkReservedSlot(src: string): string | null {
  for (const m of src.matchAll(MIN_H_RE)) {
    const tag = enclosingTag(src, m.index ?? 0);
    if (tag && isMessageTag(tag)) {
      return 'a `min-h-*` reserved height on a form-message element — the inline message must reserve NO space (a resting field with no helper/error renders nothing). Drop the reserved slot (ADR-0013 §7 "no reserved line", K-1 / #333).';
    }
  }
  return null;
}

/** B. duplicate `formDescriptionId` (co-rendered FormDescription+FormMessage, or 2 literal ids). */
function checkDuplicateDescriptionId(src: string): string | null {
  if (FORM_DESCRIPTION_USE.test(src) && FORM_MESSAGE_USE.test(src)) {
    return "a `<FormDescription>` rendered alongside a `<FormMessage>` in the same field — both claim `formDescriptionId` in the resting state, duplicating the id / ambiguating `aria-describedby`. Fold the helper into the `<FormMessage>` children (one element, one id; ADR-0013 §7, the PasswordField dup-id fix / #333).";
  }
  const ids = [...src.matchAll(DESCRIPTION_ID_ASSIGN)];
  if (ids.length >= 2) {
    return "two `id={formDescriptionId}` assignments in one file — a duplicate description id (invalid HTML / ambiguous `aria-describedby`). One element owns `formDescriptionId` (ADR-0013 §7 / #333).";
  }
  return null;
}

/** C. `text-destructive` in the opening tag of a label element (K-3 red label). */
function checkDestructiveLabel(src: string): string | null {
  let from = 0;
  for (;;) {
    const i = src.indexOf(TEXT_DESTRUCTIVE, from);
    if (i === -1) break;
    from = i + TEXT_DESTRUCTIVE.length;
    const tag = enclosingTag(src, i);
    if (tag && LABEL_TAGS.test(tag)) {
      return 'a `text-destructive` token on a field label — the label must stay NEUTRAL on error (the field is marked by its input border + focus ring + message, not a red label). Remove the destructive token from the label (ADR-0013 §7 "mark the field, not the text", K-3 / #333).';
    }
  }
  return null;
}

function checkForms(violations: Violation[]): number {
  const files = fg.sync(SCAN_GLOBS, {
    cwd: REPO_ROOT,
    ignore: SCAN_IGNORE,
    absolute: false,
  });

  let scanned = 0;
  for (const file of files) {
    const raw = readFileSync(resolve(REPO_ROOT, file), "utf8");
    if (SUPPRESS_RE.test(raw)) continue;
    const src = stripJsComments(raw);
    scanned++;

    for (const message of [
      checkReservedSlot(src),
      checkDuplicateDescriptionId(src),
      checkDestructiveLabel(src),
    ]) {
      if (message) violations.push({ file, message });
    }
  }
  return scanned;
}

function main(): void {
  const violations: Violation[] = [];
  const scanned = checkForms(violations);

  if (violations.length > 0) {
    process.stderr.write(`${TAG} ${violations.length} form-rhythm violation(s):\n`);
    for (const v of violations) {
      process.stderr.write(
        `${TAG}   ${relative(REPO_ROOT, resolve(REPO_ROOT, v.file)).replace(/\\/g, "/")}: ${v.message}\n`,
      );
    }
    process.stderr.write(
      `${TAG} The form rhythm + error-state contract is owned by ADR-0013 §7 / the ` +
        `design-system form primitives. For a genuine exception add ` +
        `/* form-rhythm-ok: <reason> */.\n`,
    );
    process.exit(1);
  }

  info(`OK — ${scanned} form file(s) honour the rhythm + error-state contract.`);
  process.exit(0);
}

main();

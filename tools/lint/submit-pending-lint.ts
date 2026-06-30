#!/usr/bin/env tsx
/**
 * tools/lint/submit-pending-lint.ts — enforcement gate for the async-submit pending
 * standard (ADR-0013 §7 "Interaction-state & motion quality contract", #337).
 *
 * Why this exists: the #333 Stage-B owner review found that on form submit the auth
 * surfaces "appear to hang" — the submit button only flipped to a static
 * `disabled={isSubmitting}` with no motion, so the user got NO progress signal on the
 * network round-trip. The design system already ships the fix as a contract: the
 * shared `Button` `loading` prop renders a determinate spinner, sets `aria-busy`, and
 * disables the control while busy (ADR-0013 §7 layer 2, #273). The defect is purely an
 * adoption gap — a page wiring `disabled={isSubmitting}` instead of
 * `loading={isSubmitting}` — and it is exactly the kind of valid-but-wrong token combo
 * the colour / interaction-states / form-* guards all miss (`disabled` is a perfectly
 * good prop; the omission of `loading` is the bug).
 *
 * What it flags (one precise, low-false-positive signal): a control explicitly marked
 * `type="submit"` whose `disabled={…}` expression is driven by an in-flight flag
 * (`isSubmitting` / `isLoading` / `isPending` / `inFlight`) while the SAME tag carries
 * no `loading=` prop. An async submit must drive the pending affordance from the
 * in-flight flag (`loading={isSubmitting}`), not a bare `disabled` — `Button.loading`
 * already disables the control internally, so `loading` is strictly the richer wiring.
 *
 * Out of scope by construction: `type="button"` controls (resend / change-method /
 * channel toggles) — their disabled state is cooldown/validity, not an async submit —
 * and any submit already passing `loading`.
 *
 * Suppression: a file may carry `/* submit-pending-ok: <reason> *\/` to acknowledge a
 * genuine exception (e.g. a submit whose async feedback is rendered elsewhere),
 * mirroring `form-error-ok` / `form-rhythm-ok` / `interaction-states-ok`. The reason
 * is required.
 *
 * Severity: WARN in Phase 0 (ADR-0007 §2.6) — same shape as `form-error` (#339),
 * `form-rhythm` (#334) and `interaction-states` (#269); the CI job uses
 * `continue-on-error`. Promote to BLOCK once stable.
 *
 * Run: `pnpm lint:submit-pending`. Violations: stderr + exit 1. Clean: exit 0.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";

// TEST SEAM: `LINT_FIXTURE_ROOT` points the scan at a fixture tree
// (tools/lint/guard-tests/fixtures/submit-pending/<case>). Inert in production — when
// unset the root resolves to the repo root, so runtime behaviour is unchanged.
const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[submit-pending]";

// The design-system blocks/primitives that own a submit control (e.g. OtpFocusScreen)
// plus the product apps that compose auth/forms from them. `apps/docs` (Fumadocs),
// `apps/cms` (Payload), `apps/mobile` (RN) theme off their own host and do not consume
// the DS Button submit contract, so it is not theirs.
const SCAN_GLOBS = [
  "packages/design-system/src/primitives/**/*.tsx",
  "packages/design-system/src/blocks/**/*.tsx",
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

const SUPPRESS_RE = /submit-pending-ok:\s*\S/;

// A `disabled={…}` whose inner expression references an in-flight flag — the RHF
// `formState.isSubmitting`, a `useTransition`/query `isPending`/`isLoading`, or a
// hand-rolled `inFlight`. `\b…\b` tolerates the dotted `form.formState.isSubmitting`.
const DISABLED_INFLIGHT_RE =
  /disabled=\{[^}]*\b(?:isSubmitting|isLoading|isPending|inFlight)\b[^}]*\}/g;

/**
 * Strip JS/TS comments so a commented-out example (a migration note) can't raise a
 * false positive. Mirrors `form-rhythm-lint.ts` / `interaction-states-lint.ts`.
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

/** Is this opening tag an explicit submit control? */
function isSubmitTag(tag: string): boolean {
  return /type=\{?["']submit["']\}?/.test(tag);
}

/** Does this opening tag already wire the `loading` pending affordance? */
function hasLoadingProp(tag: string): boolean {
  return /\bloading=/.test(tag);
}

interface Violation {
  file: string;
  message: string;
}

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

/** A submit control disabled by an in-flight flag but missing `loading`. */
function checkSubmitPending(src: string): string | null {
  for (const m of src.matchAll(DISABLED_INFLIGHT_RE)) {
    const tag = enclosingTag(src, m.index ?? 0);
    if (tag && isSubmitTag(tag) && !hasLoadingProp(tag)) {
      return 'a `type="submit"` control disabled by an in-flight flag (`disabled={…isSubmitting…}`) with no `loading` prop — a static disabled button gives NO progress signal and reads as hung (the #337 owner finding). Drive the shared `Button` pending affordance from the in-flight flag instead: `loading={isSubmitting}` (spinner + `aria-busy` + disabled-while-loading, ADR-0013 §7 layer 2).';
    }
  }
  return null;
}

function checkSubmits(violations: Violation[]): number {
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

    const message = checkSubmitPending(src);
    if (message) violations.push({ file, message });
  }
  return scanned;
}

function main(): void {
  const violations: Violation[] = [];
  const scanned = checkSubmits(violations);

  if (violations.length > 0) {
    process.stderr.write(
      `${TAG} ${violations.length} submit-pending violation(s):\n`,
    );
    for (const v of violations) {
      process.stderr.write(
        `${TAG}   ${relative(REPO_ROOT, resolve(REPO_ROOT, v.file)).replace(/\\/g, "/")}: ${v.message}\n`,
      );
    }
    process.stderr.write(
      `${TAG} The async-submit pending standard is owned by ADR-0013 §7 / the shared ` +
        `Button \`loading\` contract. For a genuine exception add ` +
        `/* submit-pending-ok: <reason> */.\n`,
    );
    process.exit(1);
  }

  info(`OK — ${scanned} form file(s) honour the async-submit pending standard.`);
  process.exit(0);
}

main();

#!/usr/bin/env tsx
/**
 * tools/lint/form-error-lint.ts — enforcement gate for the
 * "form error/message styling routes through the design-system primitive" rule
 * (ADR-0013 §7, build-ui-from-design-system gate, #333 redo / child #339).
 *
 * Why this exists: the #333 Stage-B review surfaced that the form-level submit
 * error style had been duplicated as a raw
 *   `<p role="alert" className="text-xs text-destructive">{error}</p>`
 * on 6 auth pages + a block, instead of one design-system primitive. The owner
 * caught it by eye ("у нас же должна быть дизайн-система, где мы в одном месте
 * задаём стиль ошибок"); #336 fixed it with a `FormError` primitive. No existing
 * guard catches the duplication: `interaction-states` checks hover/focus on
 * clickables, and the color / arbitrary-value guards only block raw hex / `[...]`
 * values — but `text-destructive` is a VALID token, so a hand-rolled per-page
 * error block sails through every gate. This guard is the durable, deterministic
 * fix, the same shape as `interaction-states` (#269) and the form-rhythm guard
 * (#334).
 *
 * What it checks — in app UI source (`apps/{portal,promo,admin}/{app,components,
 * src}/**`, real .tsx screens; tests / e2e / stories excluded): a hand-typed
 * form-error block, identified by the literal duplication signal — an opening JSX
 * tag that carries BOTH `role="alert"` AND a destructive text token
 * (`text-destructive`). That combination is the form-feedback shape the
 * `@ds/design-system` `FormError` / `FormMessage` primitive owns; an app-level
 * element re-typing it bypasses the single source of truth. Requiring BOTH
 * signals in the SAME tag keeps the gate precise (a bare `role="alert"` live
 * region, or a `text-destructive` used elsewhere, is not flagged) and reliable
 * (no false positives that would make the WARN noise).
 *
 * The `@ds/design-system` package itself is deliberately OUT of scope — the
 * `FormError` / `FormMessage` primitives legitimately own the `role="alert"` +
 * `text-destructive` markup in ONE place (packages/design-system/src/primitives/
 * form.tsx). The app globs never reach into `packages/`.
 *
 * Suppression: a file may carry `/* form-error-ok: <reason> *\/` to acknowledge a
 * genuine exception (e.g. a third-party widget shipping its own alert markup),
 * mirroring `interaction-states-ok`. The reason is required.
 *
 * Severity: WARN in Phase 0 (ADR-0007 §2.6: new AI-specific guards land as WARN,
 * promote to BLOCK once stable), consistent with `interaction-states` /
 * `no-stub`. The CI job uses `continue-on-error`.
 *
 * Run: `pnpm lint:form-error`. Violations: stderr + exit 1. Clean: exit 0.
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
const TAG = "[form-error]";

// App-level UI source — the product apps that consume `@ds/design-system`
// (portal / promo / admin), matching the `interaction-states` / registry-research
// surface scope. `apps/docs` (Fumadocs), `apps/cms`/`apps/docs-cms`
// (Payload/Keystatic) and `apps/mobile` (React Native — no DOM `role="alert"`)
// theme off their own host framework and do not consume the DS form primitives,
// so "route through `FormError`" is not their contract.
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

// A file may opt out with an explicit, reasoned acknowledgement.
const SUPPRESS_RE = /form-error-ok:\s*\S/;

// ── Hand-rolled form-error detection ─────────────────────────────────────────
// The signal is an opening JSX tag carrying BOTH `role="alert"` and a destructive
// text token. We locate each `role="alert"`, slice the enclosing opening tag (the
// nearest preceding `<` to the next `>`), and check that same tag for the token.
// Same-tag scoping keeps it precise; slicing to the next `>` errs toward a false
// NEGATIVE if an arrow handler's `=>` sits between the attributes — acceptable for
// a WARN gate, where a false positive would be the costly failure mode.
const ROLE_ALERT_RE = /role=["']alert["']/g;
const DESTRUCTIVE_TOKEN_RE = /text-destructive/;

/**
 * Strip JS/TS comments so a commented-out `<p role="alert" className=
 * "text-destructive">` example (a migration note) can't raise a false positive.
 * Block comments are removed wholesale; line comments only when the `//` follows
 * start-of-line or whitespace, so a `://` inside a string literal is left intact.
 * Mirrors the masking defence in `interaction-states-lint.ts`.
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

/** Does any single opening tag carry both `role="alert"` and a destructive token? */
function hasHandRolledFormError(src: string): boolean {
  for (const match of src.matchAll(ROLE_ALERT_RE)) {
    const i = match.index ?? 0;
    const start = src.lastIndexOf("<", i);
    const end = src.indexOf(">", i);
    if (start === -1 || end === -1) continue;
    const tag = src.slice(start, end + 1);
    if (DESTRUCTIVE_TOKEN_RE.test(tag)) return true;
  }
  return false;
}

function checkAppForms(violations: Violation[]): number {
  const files = fg.sync(APP_GLOBS, {
    cwd: REPO_ROOT,
    ignore: APP_IGNORE,
    absolute: false,
  });

  let scanned = 0;
  for (const file of files) {
    const raw = read(file);
    if (SUPPRESS_RE.test(raw)) continue; // reasoned opt-out lives in a comment

    // Strip comments so a commented-out example (or a migration note) can't trip
    // — only live JSX is checked.
    const src = stripJsComments(raw);
    scanned++;

    if (hasHandRolledFormError(src)) {
      violations.push({
        file,
        message:
          'hand-rolled form-error block — `role="alert"` + a `text-destructive` token typed directly in app source. Route it through the `@ds/design-system` `FormError` / `FormMessage` primitive (the error look is owned in ONE place; ADR-0013 §7 / #333). For a genuine exception add `/* form-error-ok: <reason> */`.',
      });
    }
  }
  return scanned;
}

function main(): void {
  const violations: Violation[] = [];
  const scanned = checkAppForms(violations);

  if (violations.length > 0) {
    process.stderr.write(`${TAG} ${violations.length} form-error violation(s):\n`);
    for (const v of violations) {
      process.stderr.write(
        `${TAG}   ${relative(REPO_ROOT, resolve(REPO_ROOT, v.file)).replace(/\\/g, "/")}: ${v.message}\n`,
      );
    }
    process.stderr.write(
      `${TAG} Form-error styling is owned by the FormError / FormMessage primitive ` +
        `(ADR-0013 §7 / design-system README). Don't re-type the alert markup per page.\n`,
    );
    process.exit(1);
  }

  info(`OK — ${scanned} app UI file(s) carry no hand-rolled form-error block.`);
  process.exit(0);
}

main();

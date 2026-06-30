#!/usr/bin/env tsx
/**
 * tools/lint/showcase-snippet-lint.ts — no-hand-typed-usage-snippet gate for the
 * design-system living showcase (apps/showcase) (#396; design-system-showcase
 * spec §2.4 "the showcase re-implements nothing").
 *
 * Why this exists: a `/wrap` retro caught a near-miss where an agent proposed a
 * hand-typed `AUTH_CARD_SNIPPET` STRING CONSTANT in `apps/showcase` to DEPICT how
 * a consumer wires a block — a second, hand-maintained copy of code the ONE design
 * system (`@ds/design-system`) already owns. A hand-typed snippet is the drift
 * opt-out: the package evolves, the typed string does not, and the viewer now lies.
 * That violates the showcase's core principle — it is the rendered VIEWER of the
 * package, it re-implements nothing (spec §2.4). Mature systems (shadcn Blocks,
 * Storybook autodocs) AUTO-EXTRACT the displayed code FROM the real source file
 * that renders the preview, so the shown code is the run code and cannot drift.
 * This guard makes "no hand-typed usage snippet" deterministic.
 *
 * THE detection subtlety: the bug is a STRING (quoted or template-literal) whose
 * VALUE is code depicting usage — NOT a real executable import and NOT real
 * rendered JSX. So we scan only the CONTENTS of string/template literals (a
 * char-walk that skips comments and the surrounding code), and flag a literal whose
 * body contains EITHER:
 *
 *   (a) a `@ds/design-system` import line — the text `from "@ds/design-system…"`
 *       appearing INSIDE the literal (a hand-typed copy of the package's import
 *       surface), OR
 *   (b) a JSX element opening tag with a PascalCase component name — the text
 *       `<AuthCard` / `<OtpFocusScreen …>` INSIDE the literal (a hand-typed copy
 *       of a usage example).
 *
 * What it MUST NOT flag (the real tree, which stays green): a real top-of-file
 * `import { AuthCard } from "@ds/design-system/blocks";` (executable code, not in
 * quotes) and real rendered `<AuthCard …/>` in a component return (JSX, not in
 * quotes). The char-walk only ever inspects literal BODIES, so real imports/JSX are
 * never seen — that is what distinguishes a code-string constant from real code.
 *
 * If a usage snippet is ever legitimately wanted, the rule (#396) is it MUST be
 * AUTO-EXTRACTED from a real example file (the file that renders the preview is the
 * file shown), NEVER typed — the guard message says so. For a genuine, surfaced
 * exception add `/* showcase-snippet-ok: <reason> *\/` (reason required), mirroring
 * `submit-pending-ok` / `form-rhythm-ok` / `interaction-states-ok`.
 *
 * Severity: WARN in Phase 0 (ADR-0007 §2.6: new AI-specific guards land as WARN,
 * promote to BLOCK once stable), same shape as `showcase-coverage` (#350),
 * `submit-pending` (#337), `form-rhythm` (#334). The CI job uses `continue-on-error`
 * — the WARN posture is the CI config, NOT a suppressed exit code here.
 *
 * Run: `pnpm lint:showcase-snippet`. Violations: stderr + exit 1. Clean: exit 0.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";

// TEST SEAM: `LINT_FIXTURE_ROOT` points the scan at a fixture tree
// (tools/lint/guard-tests/fixtures/showcase-snippet/<case>). Inert in production —
// when unset the root resolves to the repo root, so runtime behaviour is unchanged.
const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[showcase-snippet]";

// The showcase tree is the only target — it is the one viewer that must not
// re-implement the package (spec §2.4). Other apps are not in scope.
const SCAN_GLOBS = ["apps/showcase/**/*.tsx", "apps/showcase/**/*.ts"];
const SCAN_IGNORE = [
  "**/*.test.{ts,tsx}",
  "**/*.spec.{ts,tsx}",
  "**/*.stories.{ts,tsx}",
  "**/__tests__/**",
  "**/e2e/**",
  "**/node_modules/**",
];

const SUPPRESS_RE = /showcase-snippet-ok:\s*\S/;

// (a) a `@ds/design-system` import line typed INSIDE a literal body.
const IMPORT_IN_LITERAL_RE = /from\s+["']@ds\/design-system/;
// (b) a JSX opening tag with a PascalCase component name typed INSIDE a literal
// body (`<AuthCard` / `<OtpFocusScreen …`). The leading `<` + uppercase letter is
// the discriminator: lowercase `<div>` is host markup, not a DS component usage.
const JSX_IN_LITERAL_RE = /<[A-Z][A-Za-z0-9]*[\s/>]/;

interface Violation {
  file: string;
  message: string;
}

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

/**
 * Extract the BODIES of every string / template literal in the source, skipping
 * line + block comments and the surrounding code. A char-walk (not a line regex):
 * we must inspect only literal CONTENTS, so a real top-of-file import statement and
 * real rendered JSX — which live OUTSIDE quotes — are never seen and never flagged.
 *
 * Template-literal `${…}` substitutions are themselves code, not part of the
 * depicted snippet, so we drop their contents (treat the `${…}` span as a boundary)
 * and keep only the literal text segments.
 */
function extractLiteralBodies(src: string): string[] {
  const bodies: string[] = [];
  const n = src.length;
  let i = 0;
  let buf = "";

  while (i < n) {
    const c = src[i];
    const next = src[i + 1];

    // Line comment.
    if (c === "/" && next === "/") {
      i += 2;
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    // Block comment.
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    // Single- or double-quoted string literal.
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      buf = "";
      while (i < n) {
        if (src[i] === "\\") {
          // Keep the escaped char's payload (e.g. `\"` → `"`) so an escaped
          // angle-bracket inside the depicted snippet still reads as code.
          buf += src[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (src[i] === quote || src[i] === "\n") break; // unterminated → stop at EOL
        buf += src[i];
        i++;
      }
      i++; // consume the closing quote
      bodies.push(buf);
      continue;
    }

    // Template literal — keep the static text segments, drop `${…}` code spans.
    if (c === "`") {
      i++;
      buf = "";
      while (i < n) {
        if (src[i] === "\\") {
          buf += src[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (src[i] === "`") break;
        if (src[i] === "$" && src[i + 1] === "{") {
          // Skip the substitution span (balanced braces); its code is not snippet.
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") depth--;
            i++;
          }
          buf += " "; // boundary so adjacent segments don't fuse into a false match
          continue;
        }
        buf += src[i];
        i++;
      }
      i++; // consume the closing backtick
      bodies.push(buf);
      continue;
    }

    i++;
  }
  return bodies;
}

/** Does any string / template-literal body depict block/component usage? */
function checkSnippet(src: string): string | null {
  for (const body of extractLiteralBodies(src)) {
    if (IMPORT_IN_LITERAL_RE.test(body)) {
      return 'a string/template literal whose VALUE contains a `from "@ds/design-system…"` import line — a hand-typed copy of the package\'s import surface that DRIFTS as the package evolves (the showcase re-implements nothing, spec §2.4). If a usage snippet is wanted, AUTO-EXTRACT it from the real example file (the file that renders the preview is the file shown), never type it.';
    }
    if (JSX_IN_LITERAL_RE.test(body)) {
      return 'a string/template literal whose VALUE contains a PascalCase JSX opening tag (e.g. `<AuthCard …>`) — a hand-typed snippet DEPICTING component usage, a second hand-maintained copy of code @ds/design-system already owns that DRIFTS (the showcase re-implements nothing, spec §2.4). If a usage snippet is wanted, AUTO-EXTRACT it from the real example file (the file that renders the preview is the file shown), never type it.';
    }
  }
  return null;
}

function checkShowcase(violations: Violation[]): number {
  const files = fg.sync(SCAN_GLOBS, {
    cwd: REPO_ROOT,
    ignore: SCAN_IGNORE,
    absolute: false,
  });

  let scanned = 0;
  for (const file of files) {
    const raw = readFileSync(resolve(REPO_ROOT, file), "utf8");
    if (SUPPRESS_RE.test(raw)) continue;
    scanned++;

    const message = checkSnippet(raw);
    if (message) violations.push({ file, message });
  }
  return scanned;
}

function main(): void {
  const violations: Violation[] = [];
  const scanned = checkShowcase(violations);

  if (violations.length > 0) {
    process.stderr.write(
      `${TAG} ${violations.length} showcase-snippet violation(s):\n`,
    );
    for (const v of violations) {
      process.stderr.write(
        `${TAG}   ${relative(REPO_ROOT, resolve(REPO_ROOT, v.file)).replace(/\\/g, "/")}: ${v.message}\n`,
      );
    }
    process.stderr.write(
      `${TAG} The no-hand-typed-usage-snippet rule is owned by the design-system-showcase ` +
        `spec §2.4 ("the showcase re-implements nothing"). For a genuine exception add ` +
        `/* showcase-snippet-ok: <reason> */.\n`,
    );
    process.exit(1);
  }

  info(
    `OK — ${scanned} showcase file(s) carry no hand-typed usage snippet (no @ds/design-system import or PascalCase JSX depicted inside a string/template literal).`,
  );
  process.exit(0);
}

main();

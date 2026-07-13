#!/usr/bin/env tsx
/**
 * tools/lint/primitives-first-lint.ts — "primitives-first" static guard (#828).
 *
 * Why this exists: PR #818's pre-rework `/account` page shipped a raw
 * `next/link` (imported as `NextLink`, so the `interaction-states` scope-(c)
 * regex — which matches tags literally named `<a>` / `<Link>` — never fired)
 * carrying a bespoke `hover:bg-muted focus-visible:shadow-focus` utility stack.
 * Tokens-clean is NOT state-correct: the interaction-state contract (hover /
 * active / focus-visible, transitions, the neo-brutalist focus ring) is owned
 * ONCE by the `@ds/design-system` primitives (`Link` / `Button` / `Input` / …,
 * AGENTS.md §6 "adopt before bespoke", ADR-0013 §7). Hand-assembling those
 * states from token utilities on a raw interactive tag re-implements the
 * contract per call site — and drifts (resting underline, missing active
 * state, wrong ring) exactly as #818 did.
 *
 * What it checks: in product-app UI source (`apps/portal|promo|admin` —
 * `app/`, `components/`, `src/`; real UI .tsx only, tests / e2e / stories
 * excluded), any **raw interactive element** — a lowercase `<a>`, `<button>`,
 * `<input>`, `<textarea>`, `<select>`, or the file's `next/link` default
 * import under ANY local name (`Link`, `NextLink`, …) — whose opening tag
 * carries a `className` with a bespoke interaction-state utility
 * (`hover:` / `active:` / `focus-visible:`, incl. `group-hover:` /
 * `peer-hover:` variants) is a violation: compose the DS primitive instead
 * (`<DsLink asChild><NextLink href=…>…</NextLink></DsLink>`, `<Button asChild>`,
 * the DS `Input`, …). The primitive carries the states; the inner raw tag
 * carries only routing/semantics.
 *
 * What is deliberately ALLOWED:
 *  - A DS primitive (`<DsLink>`, `<Button>`, any non-`next/link` uppercase
 *    component) carrying `hover:` / `active:` overrides — it IS the contract
 *    owner; a canvas-pinned per-surface override on the primitive (e.g. the
 *    #818 fixed row: `hover:bg-muted hover:no-underline` on `DsLink`) is the
 *    sanctioned pattern.
 *  - A raw tag with NO state utilities (a classless `next/link` inside an
 *    `asChild` primitive, a bare `<a href>`, a layout-only className) — it
 *    declares no bespoke state contract.
 *  - An explicitly recorded exception: a `primitives-first-ok: <reason>`
 *    comment (line or JSX comment) on the flagged tag's opening line or within
 *    the 5 lines above it. The reason is REQUIRED — a bare marker does not
 *    suppress. This is the machine-readable escape hatch for genuinely
 *    primitive-less states; silence is never an opt-out.
 *
 * Relationship to `interaction-states-lint.ts` (deliberate sibling, that guard
 * is untouched): interaction-states scope (c) bans ANY styled raw `<a>` /
 * `next/link`-named-`Link` (styling ownership); THIS guard bans bespoke
 * *state* stacks on the full raw-interactive set (states ownership), closing
 * the aliased-import + `<button>`/`<input>` gap. Overlap on a styled `<a>`
 * with states is harmless (two true positives).
 *
 * Severity: WARN in Phase 0 (ADR-0007 §2.6 new-guard posture), consistent with
 * `interaction-states` / `aa-contrast`. The CI job uses `continue-on-error`.
 *
 * Run: `pnpm lint:primitives-first`. Violations: stderr + exit 1. Clean: exit 0.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";

// TEST SEAM: `LINT_FIXTURE_ROOT` lets the guard-tests harness point the scan at
// a fixture tree (tools/lint/guard-tests). Inert in production — when unset the
// root resolves to the repo root, so runtime behaviour is unchanged.
const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[primitives-first]";

// Surface scope mirrors `interaction-states` scope (c): the product apps that
// consume `@ds/design-system`. `apps/docs` / `apps/cms` / `apps/docs-cms` /
// `apps/mobile` theme off their own host framework and are not scanned.
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

// Raw interactive DOM tags whose interaction states belong to a DS primitive.
const RAW_INTERACTIVE_TAGS = ["a", "button", "input", "textarea", "select"];

// Bespoke interaction-state utilities. Matches the base prefixes and their
// `group-*` / `peer-*` variants (a bespoke group-hover is still a bespoke
// hover). `focus:` alone is not flagged — the DS contract is `focus-visible:`,
// and legacy `focus:` usage is `interaction-states` territory.
const STATE_UTILITY_RE = /(?:^|[\s"'`([{:])(?:group-|peer-)?(?:hover|active|focus-visible):/;

// Per-occurrence, reasoned, machine-readable exception. The reason is required
// and must be real text — a comment closer (`*/`, `*/}`) does NOT count as a
// reason, so a bare `{/* primitives-first-ok: */}` incantation cannot suppress.
// Recognized on the tag's opening line or within MARKER_WINDOW lines above it —
// never file-wide, so one exception cannot silence a second defect.
const SUPPRESS_RE = /primitives-first-ok:[ \t]*[^\s*/}]/;
const MARKER_WINDOW = 5;

// `next/link` default import under any local alias:
//   import Link from "next/link";  |  import NextLink from "next/link";
//   import Link, { useLinkStatus } from "next/link";
const NEXT_LINK_IMPORT_RE =
  /import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s+from\s+["']next\/link["']/g;

/**
 * Blank comments while PRESERVING length + line structure, so match offsets
 * computed on the blanked source still map to raw-source line numbers (the
 * suppression-marker window is computed on the RAW source, where the marker
 * comment lives). Line comments are blanked only when `//` follows
 * start-of-line or whitespace, so a `://` inside a string (URL) survives.
 */
function blankJsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|\s)\/\/[^\n]*/g, (m, p1: string) => p1 + " ".repeat(m.length - p1.length));
}

interface Violation {
  file: string;
  line: number;
  message: string;
}

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

/** 1-based line number of a character offset. */
function lineOf(src: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * Find the end (exclusive index of `>`) of a JSX opening tag starting at
 * `start` (the `<`). A naive `[^>]*` truncates at the `>` of an arrow function
 * inside an attribute expression (`onChange={(e) => …}`) — which silently
 * skipped the room-chat `<input focus-visible:…>` during development. So:
 * walk forward tracking `{}` depth (JSX expression containers) and skip
 * string/template literals; the tag ends at the first `>` at depth 0 outside
 * a string. Returns -1 if no terminator is found (malformed source — skip).
 */
function findTagEnd(src: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i];
    if (quote !== null) {
      if (ch === "\\") i++; // skip escaped char inside a string
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth <= 0) return i;
  }
  return -1;
}

function scanFile(file: string, violations: Violation[]): void {
  const raw = read(file);
  // Marker lines are read from the RAW source (markers live in comments).
  const rawLines = raw.split("\n");
  const markerLines = new Set<number>();
  for (let i = 0; i < rawLines.length; i++) {
    if (SUPPRESS_RE.test(rawLines[i])) markerLines.add(i + 1);
  }

  // Tag scanning runs on the comment-blanked source (a commented-out
  // `<a className="hover:…">` example must not trip), with line numbers
  // preserved by the length-keeping blanking.
  const src = blankJsComments(raw);

  const tagNames = [...RAW_INTERACTIVE_TAGS];
  for (const m of src.matchAll(NEXT_LINK_IMPORT_RE)) tagNames.push(m[1]);

  // Only locate the tag START here; the end is found by the brace-aware
  // scanner (an attribute arrow function contains a `>` that a bounded
  // `[^>]*` would mistake for the tag terminator).
  const openTagStartRe = new RegExp(`<(${tagNames.join("|")})(?=[\\s/>])`, "g");

  for (const m of src.matchAll(openTagStartRe)) {
    const end = findTagEnd(src, m.index ?? 0);
    if (end === -1) continue;
    const tagText = src.slice(m.index ?? 0, end + 1);
    const tagName = m[1];
    if (!/\bclassName\s*[={]/.test(tagText)) continue;
    if (!STATE_UTILITY_RE.test(tagText)) continue;

    const line = lineOf(src, m.index ?? 0);
    let suppressed = false;
    for (let l = Math.max(1, line - MARKER_WINDOW); l <= line; l++) {
      if (markerLines.has(l)) {
        suppressed = true;
        break;
      }
    }
    if (suppressed) continue;

    const isNextLink = !RAW_INTERACTIVE_TAGS.includes(tagName);
    violations.push({
      file,
      line,
      message: isNextLink
        ? `raw \`next/link\` \`<${tagName}>\` carries a bespoke interaction-state stack (\`hover:\`/\`active:\`/\`focus-visible:\`) — compose the \`@ds/design-system\` \`Link\` primitive (\`<DsLink asChild><${tagName} href=…/></DsLink>\`) so the primitive owns the states (AGENTS.md §6 adopt-before-bespoke; #818/#828). A recorded exception needs a \`primitives-first-ok: <reason>\` comment on/above the tag.`
        : `raw \`<${tagName}>\` carries a bespoke interaction-state stack (\`hover:\`/\`active:\`/\`focus-visible:\`) — interactive states come from a \`@ds/design-system\` primitive (\`Link\`/\`Button\`/\`Input\`/…), never hand-assembled from token utilities (AGENTS.md §6 adopt-before-bespoke; #818/#828). A recorded exception needs a \`primitives-first-ok: <reason>\` comment on/above the tag.`,
    });
  }
}

function main(): void {
  const files = fg.sync(APP_GLOBS, {
    cwd: REPO_ROOT,
    ignore: APP_IGNORE,
    absolute: false,
  });

  const violations: Violation[] = [];
  for (const file of files) scanFile(file, violations);

  if (violations.length > 0) {
    process.stderr.write(`${TAG} ${violations.length} primitives-first violation(s):\n`);
    for (const v of violations) {
      const rel = relative(REPO_ROOT, resolve(REPO_ROOT, v.file)).replace(/\\/g, "/");
      process.stderr.write(`${TAG}   ${rel}:${v.line}: ${v.message}\n`);
    }
    process.stderr.write(
      `${TAG} Interactive elements and their hover/active/focus states come from @ds/design-system primitives ` +
        `(AGENTS.md §6, ADR-0013 §7) — tokens-clean is not state-correct (#818).\n`,
    );
    process.exit(1);
  }

  info(
    `OK — ${files.length} app UI file(s): no bespoke hover/active/focus-visible stack on a raw interactive element.`,
  );
  process.exit(0);
}

main();

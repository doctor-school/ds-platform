#!/usr/bin/env tsx
/**
 * tools/lint/primitives-first-lint.ts — "primitives-first" static guard
 * (#828 raw-state loophole + #1103 shell-with-bespoke-look loophole).
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
 * #1103 closed the DUAL loophole surfaced by the /webinars month-toolbar
 * (owner verdict #6 item 2): a DS primitive used as a bare SHELL — `<Button
 * asChild>` / `<DsLink asChild>` whose call-site `className` rebuilds the
 * primitive's whole visual identity (border / fill / padding / size / shadow /
 * rounding / type-size) — passed the states-only guard because "a DS primitive
 * IS the contract owner". But rebuilding the LOOK per call site is the same
 * per-surface hand-tuning the primitive exists to prevent (it drifts — #1101's
 * month-toolbar picked up a height mismatch the moment it was re-based). And
 * `<summary>` / `<details>` (the pre-#1101 picker trigger) were not even in the
 * raw-interactive tag list.
 *
 * ── What it checks ──────────────────────────────────────────────────────────
 * In product-app UI source (`apps/portal|promo|admin` — `app/`, `components/`,
 * `src/`; real UI .tsx only, tests / e2e / stories excluded):
 *
 * (1) RAW-STATE (states ownership, #828). A **raw interactive element** — a
 *     lowercase `<a>`, `<button>`, `<input>`, `<textarea>`, `<select>`,
 *     `<summary>`, `<details>`, any tag carrying `role="button"`, or the file's
 *     `next/link` default import under ANY local name (`Link`, `NextLink`, …) —
 *     whose opening tag carries a `className` with a bespoke interaction-state
 *     utility (`hover:` / `active:` / `focus-visible:`, incl. `group-*` /
 *     `peer-*` variants) is a violation: compose the DS primitive instead
 *     (`<DsLink asChild><NextLink href=…>…</NextLink></DsLink>`, `<Button
 *     asChild>`, the DS `Input`, …). The primitive carries the states; the
 *     inner raw tag carries only routing / semantics.
 *
 * (2) SHELL (identity ownership, #1103). An **interactive DS primitive** call
 *     site — a component imported from `@ds/design-system…` whose export is
 *     `Button` or `Link` (under any local alias: `DsLink`, `IconButton`, …) —
 *     whose call-site `className` carries ≥1 STRONG visual-identity utility is
 *     a violation: it is a bare shell rebuilding the look the primitive owns.
 *     STRONG = geometry / fill / structure the primitive OWNS:
 *       border* · bg-* · px|py|p|pt|pb|pl|pr-* · h-<n> / size-<n> · shadow* ·
 *       rounded* · text-<SIZE-token> (the DS type scale: text-2xs / -caption /
 *       -body-compact / -eyebrow / -title-lg + the Tailwind scale).
 *     WEAK, never counted: positional / spacing / visibility (flex, grid, gap,
 *     m*, w-*, min-w, max-w, hidden, block, inline-*, items-*, justify-*,
 *     self-*, order-*, place-*, shrink-*, space-*), font-WEIGHT (`font-bold`,
 *     a per-surface weight tweak the primitives tolerate), text-COLOR / -ALIGN
 *     (`text-header-foreground`, `text-center`), tracking / leading / opacity /
 *     decoration, and anything behind a STATE variant (`hover:` / `active:` /
 *     `focus*:` / `group-*:` / `peer-*:` — a state override IS the primitive's
 *     to carry, rule 1's territory). Responsive / theme variants (`layout:`,
 *     `sm:`, `dark:`) do NOT neutralise a strong base — `layout:text-lg` is
 *     still a type-size override and counts.
 *
 *     Threshold = ≥1 strong. Calibrated against the #1103 ledger (the
 *     acceptance fixture): the strict ≥2 starting point MISSED four real shells
 *     that carry a single type-size override (`back-to-list` `text-sm`,
 *     `account` profile-edit, mobile week links) — a lone type-size on a
 *     primitive already rebuilds its identity. Excluding font-WEIGHT keeps the
 *     header `NavLink` (a lone `font-bold` on a DsLink) compliant, matching the
 *     ledger's OK-OVERRIDE classification. Both edges are ledger-driven.
 *
 * ── Deliberately ALLOWED ────────────────────────────────────────────────────
 *  - A DS primitive carrying only STATE overrides (`hover:` / `active:` /
 *    `focus-visible:`) — it IS the state-contract owner; a canvas-pinned
 *    per-surface state override (the #818 fixed row: `hover:bg-muted
 *    hover:no-underline` on `DsLink`) is the sanctioned pattern.
 *  - A DS primitive carrying only WEAK/positional classes (`justify-center`,
 *    `w-full`, `font-bold`, `text-header-foreground`) — layout + a weight/colour
 *    context tweak, not an identity rebuild.
 *  - A raw tag with NO state utilities (a classless `next/link` inside an
 *    `asChild` primitive, a bare `<a href>`, a layout-only className).
 *  - An explicitly recorded exception: a `primitives-first-ok: <reason>`
 *    comment (line or JSX comment) on the flagged tag's opening line or within
 *    the 5 lines above it, honoured by BOTH rules. The reason is REQUIRED — a
 *    bare marker does not suppress. This is the machine-readable escape hatch;
 *    silence is never an opt-out.
 *
 * Relationship to `interaction-states-lint.ts` (deliberate sibling, untouched):
 * interaction-states checks layer-1 globals + the primitives' OWN contract, not
 * consumer call sites; THIS guard governs the call sites (states + identity).
 *
 * ── Severity / exit code — WARN lives in the EXIT CODE, not CI config ────────
 * The exit code, NOT a job-level `continue-on-error`, carries WARN semantics —
 * a `continue-on-error` job keeps the WORKFLOW green but its CHECK-RUN still
 * concludes FAILURE, which `merge:gate` treats as blocking, so a standing-WARN
 * finding would red every future PR's merge gate (#1108 rework). Therefore:
 *   - BLOCK findings → printed + EXIT 1. These are the original #828 raw-state
 *     class: a bespoke state stack on a raw `<a>`/`<button>`/`<input>`/
 *     `<textarea>`/`<select>` or a `next/link` alias. Currently ZERO in-repo
 *     (all such call sites carry a recorded `primitives-first-ok:` marker), so
 *     the check-run is green today; a NEW one is a hard regression.
 *   - WARN findings → printed + EXIT 0 (Phase 0, ADR-0007 §2.6). The #1103
 *     additions: `<summary>`/`<details>`/`role="button"` raw-state hosts and the
 *     SHELL class. Visible on every run, non-blocking, check-run stays green.
 * A run with BOTH exits 1 (the block dominates). WARN→BLOCK promotion for the
 * #1103 classes: once the app-code WARN count reaches 0 and holds for one sweep
 * cadence (ADR-0007 §2.6), move those tags/SHELL into the block set — a new
 * bespoke shell is then a hard regression, not drift. The CI job runs WITHOUT
 * `continue-on-error`: the tool's own exit code is the single severity source.
 *
 * Run: `pnpm lint:primitives-first`. BLOCK: stderr + exit 1. WARN-only: stderr +
 * exit 0. Clean: exit 0.
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
// The #828 originals (`BLOCK_RAW_TAGS`) exit 1 on a finding; the #1103 additions
// (`summary`/`details` — the pre-#1101 disclosure-picker trigger) are WARN (exit
// 0) until they promote to BLOCK. `role="button"` hosts (WARN) are handled
// separately (keyed off the attribute, any tag name).
const BLOCK_RAW_TAGS = ["a", "button", "input", "textarea", "select"];
const WARN_RAW_TAGS = ["summary", "details"];
const RAW_INTERACTIVE_TAGS = [...BLOCK_RAW_TAGS, ...WARN_RAW_TAGS];

// Bespoke interaction-state utilities. Matches the base prefixes and their
// `group-*` / `peer-*` variants (a bespoke group-hover is still a bespoke
// hover). `focus:` alone is not flagged — the DS contract is `focus-visible:`,
// and legacy `focus:` usage is `interaction-states` territory.
const STATE_UTILITY_RE = /(?:^|[\s"'`([{:])(?:group-|peer-)?(?:hover|active|focus-visible):/;

// A `role="button"` (or `role='button'`) host — a non-`<button>` tag given
// button semantics (#1103 (a)). Detected wherever it appears in an opening tag.
const ROLE_BUTTON_RE = /\brole\s*=\s*["']button["']/;

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

// A `@ds/design-system…` import statement (any subpath): captures the whole
// clause so we can enumerate every local name it binds (named + aliased +
// default). Only the INTERACTIVE primitives (`Button`, `Link`) are shell-checked
// — layout primitives (`Container`, `Card`, `Badge`) legitimately carry
// padding / bg and are out of the #1103 "bespoke interactive control" scope.
const DS_IMPORT_RE = /import\s+([\s\S]*?)\s+from\s+["']@ds\/design-system[^"']*["']/g;
const INTERACTIVE_DS_EXPORTS = new Set(["Button", "Link"]);

// STRONG visual-identity bases (#1103 SHELL). A DS primitive owns these; a call
// site overriding any is rebuilding the primitive's look. `w-*` is positional
// (width), deliberately excluded per the ledger's OK-OVERRIDE family.
const STRONG_BASE_RES = [
  /^border(-|$)/, // border, border-t, border-2, border-l-2, border-border, border-hairline
  /^bg-/, // fill
  /^p([xytblr])?-/, // padding: p- px- py- pt- pb- pl- pr-
  /^h-\d/, // explicit height
  /^h-\[/,
  /^size-\d/, // square sizing (h+w)
  /^size-\[/,
  /^shadow(-|$)/,
  /^rounded(-|$)/,
];
// DS type-scale + Tailwind scale. Distinguishes text-<SIZE> (strong) from
// text-<colour> (`text-foreground`) and text-<align> (`text-center`) — WEAK.
const TEXT_SIZE_RE =
  /^text-(2xs|xs|sm|base|lg|xl|[2-9]xl|eyebrow|caption|body-compact|title-lg)$/;
// Variant prefixes that mark a token as a STATE override (allowed on a primitive
// — rule 1's territory), so it is excluded from the strong-identity count.
const STATE_VARIANT_RE =
  /^(hover|active|focus|focus-visible|focus-within|disabled|visited|target|checked|enabled|open|first|last|odd|even|before|after|selection|placeholder|read-only|aria-.+|data-.+|group-.*|peer-.*)$/;

const SHELL_THRESHOLD = 1;

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
  /** `block` → exit 1 (original #828 raw-state class); `warn` → exit 0 (#1103). */
  severity: "block" | "warn";
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

/**
 * The `<` index of the opening tag enclosing `offset` — walk back to the
 * nearest `<` whose brace-aware end is at/after `offset`. Used for the
 * `role="button"` host, whose tag NAME is unknown (any element can carry it).
 */
function enclosingTagStart(src: string, offset: number): number {
  for (let i = offset; i >= 0; i--) {
    if (src[i] === "<") {
      const end = findTagEnd(src, i);
      if (end >= offset) return i;
      return -1; // nearest `<` closes before the attr — malformed, skip
    }
  }
  return -1;
}

/** Module-level `const NAME = "…"` string constants → resolved className text. */
function collectStringConsts(src: string): Map<string, string> {
  const consts = new Map<string, string>();
  const re = /(?:^|\n)\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*?);/g;
  for (const m of src.matchAll(re)) {
    const init = m[2];
    const literals = [...init.matchAll(/["'`]([^"'`]*)["'`]/g)].map((s) => s[1]);
    if (literals.length > 0) consts.set(m[1], literals.join(" "));
  }
  return consts;
}

/**
 * Resolve the className text of a JSX opening tag: the `"…"` literal, or every
 * string literal inside a `className={…}` expression (`cn("a", cond && "b")`),
 * plus any bare identifier there that maps to a module string const
 * (`className={AVATAR_CHIP}`). Returns "" when no className / none resolvable.
 */
function classNameText(tagText: string, consts: Map<string, string>): string {
  const eq = tagText.search(/\bclassName\s*=/);
  if (eq === -1) return "";
  let i = eq + tagText.slice(eq).indexOf("=") + 1;
  while (i < tagText.length && /\s/.test(tagText[i])) i++;
  const ch = tagText[i];
  if (ch === '"' || ch === "'") {
    const close = tagText.indexOf(ch, i + 1);
    return close === -1 ? "" : tagText.slice(i + 1, close);
  }
  if (ch !== "{") return "";
  // Balanced `{…}` region.
  let depth = 0;
  let end = -1;
  for (let j = i; j < tagText.length; j++) {
    if (tagText[j] === "{") depth++;
    else if (tagText[j] === "}" && --depth === 0) {
      end = j;
      break;
    }
  }
  const expr = tagText.slice(i + 1, end === -1 ? tagText.length : end);
  const frags = [...expr.matchAll(/["'`]([^"'`]*)["'`]/g)].map((s) => s[1]);
  for (const id of expr.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
    const v = consts.get(id[1]);
    if (v) frags.push(v);
  }
  return frags.join(" ");
}

/** ≥1 STRONG visual-identity utility? (Rule 2 — SHELL.) */
function strongIdentityCount(className: string): number {
  let n = 0;
  for (const raw of className.split(/\s+/)) {
    if (!raw) continue;
    const parts = raw.split(":");
    const base = parts[parts.length - 1];
    const prefixes = parts.slice(0, -1);
    if (prefixes.some((p) => STATE_VARIANT_RE.test(p))) continue; // state override — allowed
    if (TEXT_SIZE_RE.test(base) || STRONG_BASE_RES.some((re) => re.test(base))) n++;
  }
  return n;
}

function isSuppressed(markerLines: Set<number>, line: number): boolean {
  for (let l = Math.max(1, line - MARKER_WINDOW); l <= line; l++) {
    if (markerLines.has(l)) return true;
  }
  return false;
}

const RECORDED_EXCEPTION =
  "A recorded exception needs a `primitives-first-ok: <reason>` comment on/above the tag.";

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
  const consts = collectStringConsts(src);

  // ── Rule 1: raw-interactive STATE stacks (#828) ─────────────────────────
  const nextLinkNames: string[] = [];
  for (const m of src.matchAll(NEXT_LINK_IMPORT_RE)) nextLinkNames.push(m[1]);
  const rawTagNames = [...RAW_INTERACTIVE_TAGS, ...nextLinkNames];
  const rawStart = new RegExp(`<(${rawTagNames.join("|")})(?=[\\s/>])`, "g");
  const flaggedStarts = new Set<number>();

  for (const m of src.matchAll(rawStart)) {
    const start = m.index ?? 0;
    const end = findTagEnd(src, start);
    if (end === -1) continue;
    const tagText = src.slice(start, end + 1);
    const tagName = m[1];
    if (!/\bclassName\s*[={]/.test(tagText)) continue;
    if (!STATE_UTILITY_RE.test(tagText)) continue;

    const line = lineOf(src, start);
    if (isSuppressed(markerLines, line)) continue;
    flaggedStarts.add(start);

    const isNextLink = !RAW_INTERACTIVE_TAGS.includes(tagName);
    // #828 originals (raw DOM tags + next/link aliases) BLOCK; the #1103
    // `summary`/`details` additions are WARN until promotion.
    const severity: "block" | "warn" =
      isNextLink || BLOCK_RAW_TAGS.includes(tagName) ? "block" : "warn";
    violations.push({
      file,
      line,
      severity,
      message: isNextLink
        ? `raw \`next/link\` \`<${tagName}>\` carries a bespoke interaction-state stack (\`hover:\`/\`active:\`/\`focus-visible:\`) — compose the \`@ds/design-system\` \`Link\` primitive (\`<DsLink asChild><${tagName} href=…/></DsLink>\`) so the primitive owns the states (AGENTS.md §6 adopt-before-bespoke; #818/#828). ${RECORDED_EXCEPTION}`
        : `raw \`<${tagName}>\` carries a bespoke interaction-state stack (\`hover:\`/\`active:\`/\`focus-visible:\`) — interactive states come from a \`@ds/design-system\` primitive (\`Link\`/\`Button\`/\`Input\`/…), never hand-assembled from token utilities (AGENTS.md §6 adopt-before-bespoke; #818/#828). ${RECORDED_EXCEPTION}`,
    });
  }

  // `role="button"` host (#1103 (a)) — any tag, so keyed off the attribute.
  for (const m of src.matchAll(new RegExp(ROLE_BUTTON_RE, "g"))) {
    const start = enclosingTagStart(src, m.index ?? 0);
    if (start === -1 || flaggedStarts.has(start)) continue;
    const end = findTagEnd(src, start);
    if (end === -1) continue;
    const tagText = src.slice(start, end + 1);
    if (!/\bclassName\s*[={]/.test(tagText)) continue;
    if (!STATE_UTILITY_RE.test(tagText)) continue;
    const line = lineOf(src, start);
    if (isSuppressed(markerLines, line)) continue;
    flaggedStarts.add(start);
    violations.push({
      file,
      line,
      severity: "warn", // #1103 addition
      message: `\`role="button"\` host carries a bespoke interaction-state stack (\`hover:\`/\`active:\`/\`focus-visible:\`) — a button's states come from the \`@ds/design-system\` \`Button\` primitive, never hand-assembled on a role-hacked element (AGENTS.md §6; #828/#1103). ${RECORDED_EXCEPTION}`,
    });
  }

  // ── Rule 2: SHELL — interactive DS primitive rebuilding its look (#1103) ──
  const shellNames: string[] = [];
  for (const m of src.matchAll(DS_IMPORT_RE)) {
    for (const spec of m[1].matchAll(/([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?/g)) {
      const orig = spec[1];
      const local = spec[2] ?? spec[1];
      if (orig === "import" || orig === "type" || local === "type") continue;
      if (INTERACTIVE_DS_EXPORTS.has(orig)) shellNames.push(local);
    }
  }
  if (shellNames.length > 0) {
    const uniq = [...new Set(shellNames)];
    const shellStart = new RegExp(`<(${uniq.join("|")})(?=[\\s/>])`, "g");
    for (const m of src.matchAll(shellStart)) {
      const start = m.index ?? 0;
      const end = findTagEnd(src, start);
      if (end === -1) continue;
      const tagText = src.slice(start, end + 1);
      if (!/\bclassName\s*[={]/.test(tagText)) continue;
      const strong = strongIdentityCount(classNameText(tagText, consts));
      if (strong < SHELL_THRESHOLD) continue;
      const line = lineOf(src, start);
      if (isSuppressed(markerLines, line)) continue;
      violations.push({
        file,
        line,
        severity: "warn", // #1103 SHELL class
        message: `DS primitive \`<${m[1]}>\` used as a bespoke-look shell: its call-site \`className\` carries ${strong} strong visual-identity override(s) (border/bg/padding/size/shadow/rounded/text-size) that rebuild the identity the primitive owns — use the primitive's variant/size props (or add a DS variant), not per-call-site look overrides (AGENTS.md §6 adopt-before-bespoke; #1103). ${RECORDED_EXCEPTION}`,
      });
    }
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

  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const blocking = violations.filter((v) => v.severity === "block");
  const warnings = violations.filter((v) => v.severity === "warn");

  if (violations.length > 0) {
    const kind = blocking.length > 0 ? "violation" : "WARN finding";
    process.stderr.write(
      `${TAG} ${violations.length} primitives-first ${kind}(s) ` +
        `(${blocking.length} BLOCK, ${warnings.length} WARN):\n`,
    );
    for (const v of violations) {
      const rel = relative(REPO_ROOT, resolve(REPO_ROOT, v.file)).replace(/\\/g, "/");
      process.stderr.write(
        `${TAG}   ${v.severity.toUpperCase()} ${rel}:${v.line}: ${v.message}\n`,
      );
    }
    process.stderr.write(
      `${TAG} Interactive elements own their hover/active/focus states AND their visual identity ` +
        `via @ds/design-system primitives (AGENTS.md §6, ADR-0013 §7) — a bespoke state stack (#818) ` +
        `or a call-site look rebuild (#1103) both re-implement the contract per surface and drift.\n`,
    );
  }

  // WARN severity lives in the exit code: BLOCK (original #828 raw-state class)
  // fails the check-run; the #1103 WARN classes stay visible but exit 0 so the
  // check-run is green and never blocks `merge:gate` (#1108 rework).
  if (blocking.length > 0) {
    process.stderr.write(
      `${TAG} ${blocking.length} BLOCK finding(s) — failing (exit 1).\n`,
    );
    process.exit(1);
  }
  if (warnings.length > 0) {
    info(
      `${warnings.length} WARN finding(s) above — Phase 0 non-blocking (exit 0). ` +
        `Promote the #1103 classes to BLOCK once the count holds at 0 (ADR-0007 §2.6).`,
    );
    process.exit(0);
  }
  info(
    `OK — ${files.length} app UI file(s): no bespoke state stack on a raw interactive element, ` +
      `no interactive DS primitive used as a bespoke-look shell.`,
  );
  process.exit(0);
}

main();

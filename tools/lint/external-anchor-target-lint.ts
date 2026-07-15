#!/usr/bin/env tsx
/**
 * tools/lint/external-anchor-target-lint.ts — external-document anchor
 * surface-parity guard (Issue #867).
 *
 * Why this exists: the program-PDF affordance shipped to prod with
 * `target="_blank" rel="noreferrer"` on the ADMIN surface
 * (`apps/admin/components/event-form.tsx`) but WITHOUT them on the PUBLIC event
 * page (`packages/design-system/src/primitives/webinar-page-content.tsx`) — the
 * owner hit same-tab navigation on the public page at the #729 re-check (#864,
 * fixed by PR #865). Two surfaces rendered the same affordance and drifted on
 * anchor attributes; no gate caught it. `root_cause: prose-not-enforced` → this
 * deterministic gate.
 *
 * What it enforces: every EXTERNAL-DOCUMENT `<a>` on a user-facing surface must
 * carry BOTH `target="_blank"` AND a `rel` containing `noreferrer` or
 * `noopener` (reverse-tabnabbing / referrer-leak protection for a link that
 * opens a new browsing context).
 *
 * Scope surfaces: `apps/portal`, `apps/admin`, `packages/design-system/src`
 * (the DS primitives the showcase inherits). Tests / stories are excluded.
 *
 * ── "external-document" heuristic ─────────────────────────────────────────────
 * Only real JSX `<a …>` opening tags are scanned (a `<a>` appearing inside a
 * string literal or a comment is NOT a tag). An anchor is EXTERNAL when its
 * `href` is:
 *   (a) a LITERAL external URL — `http(s)://…`, a protocol-relative `//host`, or
 *       any other `scheme://…`; OR
 *   (b) bound to a URL-typed prop/field — an expression whose trailing
 *       identifier segment ends in `Url`/`Uri` (case-insensitive), e.g.
 *       `href={programPdfUrl}` / `href={detail.programPdfUrl}`.
 *
 * EXEMPT (never flagged): in-app navigation — a relative/root/anchor literal
 * (`/…`, `./…`, `../…`, `#…`), a Next `<Link>` (not an `<a>`), an expression
 * whose trailing identifier is NOT `*Url`/`*Uri` (`href={href}`, `href={ctaHref}`
 * — the guard does not guess the value of an arbitrary route prop), and the
 * non-browsing-context schemes `mailto:` / `tel:` / `sms:` (these do not open a
 * web browsing context, so `target=_blank` + `rel=noopener` do not apply — a
 * deliberate scoping decision, documented here and in the guard-tests README).
 *
 * ── False-positive policy (suppression hatch) ─────────────────────────────────
 * A deliberate same-tab external anchor (or a known false positive) is
 * acknowledged with an inline `// external-anchor-ok: <reason>` comment on any
 * line the opening tag spans. The reason is REQUIRED.
 *
 * ── Robustness (the #936 review lessons) ──────────────────────────────────────
 * A string/comment-aware pre-pass blanks `//` and `/* … *\/` comments while
 * preserving string contents (so `href="https://…"` is NOT truncated at the
 * `//`, and a `<a>` written inside a string literal or a comment is not treated
 * as a tag). The pre-pass only ever REMOVES comment text — it can never
 * introduce a false positive. The suppression marker is matched against the RAW
 * source lines (the marker lives in a comment the pre-pass would have blanked).
 *
 * ── Output / severity ─────────────────────────────────────────────────────────
 * Each offending anchor → stderr `file:line  <reason>` + exit 1. Clean → exit 0.
 * WARN v1 in Phase 0 (ADR-0007 §2.6; new guard lands WARN, the CI job uses
 * `continue-on-error: true`, promote to BLOCK once stable).
 *
 * Seam: `LINT_FIXTURE_ROOT` (guard-tests harness) points the scan at a fixture
 * tree; inert in production (unset → repo root from import.meta.url).
 * Run: `pnpm lint:external-anchor`. Findings: stderr + exit 1. Clean: exit 0.
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
const TAG = "[external-anchor]";

/** Surfaces whose external-document anchors are checked. */
const GLOBS = [
  "apps/portal/**/*.{ts,tsx}",
  "apps/admin/**/*.{ts,tsx}",
  "packages/design-system/src/**/*.{ts,tsx}",
];
const IGNORE = [
  "**/node_modules/**",
  "**/.next/**",
  "**/dist/**",
  "**/*.test.{ts,tsx}",
  "**/*.spec.{ts,tsx}",
  "**/*.stories.{ts,tsx}",
  "**/__tests__/**",
];

const SUPPRESS_RE = /\bexternal-anchor-ok\s*:\s*\S/i;
/** A trailing identifier ending in `Url`/`Uri` marks a URL-typed prop/field. */
const URL_PROP_RE = /(?:url|uri)$/i;
/** Schemes that do NOT open a web browsing context (exempt from target/rel). */
const NON_BROWSING_SCHEME_RE = /^(?:mailto|tel|sms|callto|facetime):/i;

interface Finding {
  file: string;
  line: number;
  reason: string;
}

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

/**
 * String/comment-aware pre-pass: return a copy of `source` with `//` and
 * `/* … *\/` comments blanked (replaced by spaces, newlines preserved so byte /
 * line offsets are stable) while string literals (`"…"`, `'…'`, `` `…` ``) are
 * copied VERBATIM. Only ever removes comment text, so it can never turn a
 * non-anchor into an anchor. Template `${…}` bodies are treated as opaque string
 * content — hrefs never embed comments inside an interpolation.
 */
function blankComments(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  type State = "code" | "line" | "block" | "dq" | "sq" | "tpl";
  let state: State = "code";
  while (i < n) {
    const c = source[i];
    const c2 = i + 1 < n ? source[i + 1] : "";
    if (state === "code") {
      if (c === "/" && c2 === "/") {
        state = "line";
        out += "  ";
        i += 2;
        continue;
      }
      if (c === "/" && c2 === "*") {
        state = "block";
        out += "  ";
        i += 2;
        continue;
      }
      if (c === '"') state = "dq";
      else if (c === "'") state = "sq";
      else if (c === "`") state = "tpl";
      out += c;
      i += 1;
      continue;
    }
    if (state === "line") {
      // Blank to end of line; keep the newline so line numbers stay aligned.
      out += c === "\n" || c === "\r" ? c : " ";
      if (c === "\n") state = "code";
      i += 1;
      continue;
    }
    if (state === "block") {
      if (c === "*" && c2 === "/") {
        state = "code";
        out += "  ";
        i += 2;
        continue;
      }
      out += c === "\n" || c === "\r" ? c : " ";
      i += 1;
      continue;
    }
    // string states (dq / sq / tpl): copy verbatim, honour escapes.
    if (c === "\\") {
      out += c + c2;
      i += 2;
      continue;
    }
    out += c;
    if (
      (state === "dq" && c === '"') ||
      (state === "sq" && c === "'") ||
      (state === "tpl" && c === "`")
    ) {
      state = "code";
    }
    i += 1;
  }
  return out;
}

/**
 * Extract every real JSX `<a …>` opening-tag substring from comment-blanked
 * `code`, with the source offset where each tag starts. String/brace-aware:
 * skips `<a` inside a string literal and treats a `>` inside a string or a `{…}`
 * expression as part of the tag, not its terminator.
 */
function extractAnchorTags(
  code: string,
): { tag: string; startOffset: number }[] {
  const tags: { tag: string; startOffset: number }[] = [];
  let i = 0;
  const n = code.length;
  type S = "code" | "dq" | "sq" | "tpl";
  let state: S = "code";
  while (i < n) {
    const c = code[i];
    if (state === "code") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === '"') {
        state = "dq";
        i += 1;
        continue;
      }
      if (c === "'") {
        state = "sq";
        i += 1;
        continue;
      }
      if (c === "`") {
        state = "tpl";
        i += 1;
        continue;
      }
      // A JSX anchor opener: `<a` followed by whitespace, `>` or `/`.
      if (c === "<" && code[i + 1] === "a") {
        const after = code[i + 2] ?? "";
        if (after === "" || /[\s/>]/.test(after)) {
          const end = scanTagEnd(code, i);
          if (end !== -1) {
            tags.push({ tag: code.slice(i, end + 1), startOffset: i });
            i = end + 1;
            continue;
          }
        }
      }
      i += 1;
      continue;
    }
    // inside a string: copy through to the closing quote.
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (
      (state === "dq" && c === '"') ||
      (state === "sq" && c === "'") ||
      (state === "tpl" && c === "`")
    ) {
      state = "code";
    }
    i += 1;
  }
  return tags;
}

/**
 * Given `code` and the index of a `<a` opener, return the index of the `>` that
 * closes the opening tag (string- and brace-depth aware), or -1 if unterminated.
 */
function scanTagEnd(code: string, start: number): number {
  let i = start + 2;
  const n = code.length;
  let depth = 0; // `{…}` expression-container depth
  type S = "code" | "dq" | "sq" | "tpl";
  let state: S = "code";
  while (i < n) {
    const c = code[i];
    if (state === "code") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === '"') {
        state = "dq";
      } else if (c === "'") {
        state = "sq";
      } else if (c === "`") {
        state = "tpl";
      } else if (c === "{") {
        depth += 1;
      } else if (c === "}") {
        if (depth > 0) depth -= 1;
      } else if (c === ">" && depth === 0) {
        return i;
      }
      i += 1;
      continue;
    }
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (
      (state === "dq" && c === '"') ||
      (state === "sq" && c === "'") ||
      (state === "tpl" && c === "`")
    ) {
      state = "code";
    }
    i += 1;
  }
  return -1;
}

/** Extract the raw `href` attribute value + whether it is a `{…}` expression. */
function extractHref(tag: string): { value: string; isExpr: boolean } | null {
  const m = /\bhref\s*=\s*/.exec(tag);
  if (!m) return null;
  let i = m.index + m[0].length;
  const c = tag[i];
  if (c === '"' || c === "'") {
    const close = tag.indexOf(c, i + 1);
    if (close === -1) return null;
    return { value: tag.slice(i + 1, close), isExpr: false };
  }
  if (c === "{") {
    // Balanced-brace expression, string-aware.
    let depth = 0;
    let state: "code" | "dq" | "sq" | "tpl" = "code";
    const startExpr = i + 1;
    while (i < tag.length) {
      const ch = tag[i];
      if (state === "code") {
        if (ch === '"') state = "dq";
        else if (ch === "'") state = "sq";
        else if (ch === "`") state = "tpl";
        else if (ch === "{") depth += 1;
        else if (ch === "}") {
          depth -= 1;
          if (depth === 0)
            return { value: tag.slice(startExpr, i).trim(), isExpr: true };
        }
      } else if (
        (state === "dq" && ch === '"') ||
        (state === "sq" && ch === "'") ||
        (state === "tpl" && ch === "`")
      ) {
        state = "code";
      }
      i += 1;
    }
    return null;
  }
  return null;
}

/** Classify a literal href string (or a template's static prefix). */
function classifyLiteral(v: string): "external" | "exempt" {
  const s = v.trim();
  if (/^https?:\/\//i.test(s) || s.startsWith("//")) return "external";
  if (NON_BROWSING_SCHEME_RE.test(s)) return "exempt";
  // Any other explicit `scheme://…` is an external browsing-context nav.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return "external";
  // Relative / root-absolute / hash / scheme-less → in-app, exempt.
  return "exempt";
}

/**
 * Classify an href: external (requires target/rel) or exempt. `isExpr` selects
 * the literal-string path vs the JS-expression path.
 */
function classifyHref(value: string, isExpr: boolean): "external" | "exempt" {
  if (!isExpr) return classifyLiteral(value);
  const e = value.trim();
  // A string / template literal inside braces: `{"https://…"}` / `{`/x/${id}`}`.
  if (e[0] === '"' || e[0] === "'" || e[0] === "`") {
    const quote = e[0];
    if (quote === "`") {
      // Template: classify by the STATIC prefix before the first `${…}`.
      const interp = e.indexOf("${");
      const prefix = e.slice(1, interp === -1 ? e.length - 1 : interp);
      if (prefix.length === 0) return "exempt"; // dynamic-first → can't tell
      return classifyLiteral(prefix);
    }
    const close = e.indexOf(quote, 1);
    return classifyLiteral(close === -1 ? e.slice(1) : e.slice(1, close));
  }
  // A JS identifier / member / call expression. The trailing identifier segment
  // ending in `Url`/`Uri` marks a URL-typed prop (heuristic (b)); anything else
  // is an arbitrary route value the guard does not guess about → exempt.
  const idents = e.match(/[A-Za-z_$][\w$]*/g);
  if (!idents || idents.length === 0) return "exempt";
  const last = idents[idents.length - 1];
  return URL_PROP_RE.test(last) ? "external" : "exempt";
}

/** Does the tag carry `target="_blank"` (string or `{"_blank"}` form)? */
function hasBlankTarget(tag: string): boolean {
  return /\btarget\s*=\s*(?:["']_blank["']|\{\s*["'`]_blank["'`]\s*\})/.test(
    tag,
  );
}

/** Does the tag carry a `rel` containing `noopener` or `noreferrer`? */
function hasProtectiveRel(tag: string): boolean {
  const m =
    /\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["'`]([^"'`]*)["'`]\s*\})/.exec(
      tag,
    );
  if (!m) return false;
  const rel = (m[1] ?? m[2] ?? m[3] ?? "").toLowerCase();
  return /\bno(?:opener|referrer)\b/.test(rel);
}

async function main(): Promise<void> {
  const files = await fg(GLOBS, {
    cwd: REPO_ROOT,
    ignore: IGNORE,
    absolute: true,
  });

  const findings: Finding[] = [];
  let anchorCount = 0;

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const rawLines = source.split(/\r?\n/);
    const code = blankComments(source);

    for (const { tag, startOffset } of extractAnchorTags(code)) {
      anchorCount += 1;
      const href = extractHref(tag);
      if (!href) continue; // no href (e.g. `<a>` used as a target anchor) → skip
      if (classifyHref(href.value, href.isExpr) !== "external") continue;

      // Line span of this tag (1-based), for suppression + reporting.
      const startLine = code.slice(0, startOffset).split(/\r?\n/).length;
      const endLine = startLine + (tag.match(/\r?\n/g)?.length ?? 0);

      // Suppression marker (`// external-anchor-ok: …`) on any spanned raw line.
      let suppressed = false;
      for (let ln = startLine; ln <= endLine; ln += 1) {
        if (SUPPRESS_RE.test(rawLines[ln - 1] ?? "")) {
          suppressed = true;
          break;
        }
      }
      if (suppressed) continue;

      const missing: string[] = [];
      if (!hasBlankTarget(tag)) missing.push('target="_blank"');
      if (!hasProtectiveRel(tag)) missing.push("rel with noopener/noreferrer");
      if (missing.length > 0) {
        findings.push({ file, line: startLine, reason: missing.join(" + ") });
      }
    }
  }

  info(
    `scanned ${files.length} source file(s); inspected ${anchorCount} anchor(s).`,
  );

  if (findings.length === 0) {
    info(
      "PASS — every external-document anchor carries target=_blank + a protective rel.",
    );
    process.exit(0);
  }

  for (const f of findings) {
    const rel = relative(REPO_ROOT, f.file).replace(/\\/g, "/");
    process.stderr.write(`${TAG} ${rel}:${f.line}  missing ${f.reason}\n`);
  }
  process.stderr.write(
    `${TAG} FAIL — ${findings.length} external-document anchor(s) missing new-tab safety. ` +
      "An external `<a>` (an `http(s)://…` literal or a `*Url`/`*Uri`-typed prop) must carry " +
      '`target="_blank"` AND a `rel` containing `noreferrer`/`noopener` (surface-parity ' +
      "gate, #867 — the #864/#865 same-tab drift). A deliberate same-tab external anchor may " +
      "carry `// external-anchor-ok: <reason>` on a spanned line.\n",
  );
  process.exit(1);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});

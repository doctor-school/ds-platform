#!/usr/bin/env tsx
/**
 * tools/lint/retained-data-lint.ts — regression guard for the retained-row
 * lifecycle (#1278 slice C, #1404).
 *
 * Why this exists: #1278 aligns application-owned Postgres data on LOGICAL
 * retention (soft-delete / status transitions) instead of physical row removal —
 * retained rows survive for audit, consent and analytics. Nothing in CI stopped a
 * PR from reintroducing physical deletion: no gate scanned for `tx.delete(` /
 * raw `DELETE FROM` / `TRUNCATE` / `DROP TABLE` against application tables, and
 * nothing blocked a NEW `onDelete: 'cascade'` FK, which deletes retained child
 * rows implicitly when the parent goes away.
 *
 * What it flags:
 *
 *   1. CASCADE — `onDelete: "cascade"` on a `.references(...)` in
 *      `packages/db/src/schema/**`. A cascade is an implicit physical delete of
 *      retained child rows.
 *   2. PHYSICAL-DELETE — a Drizzle `.delete(` call on a database handle
 *      (`db` / `tx` / `trx` / `conn` / `client` / `this.db` …), or a raw
 *      `DELETE FROM` / `TRUNCATE` / `DROP TABLE` statement, anywhere in
 *      `apps/api/src/**` or `apps/api/scripts/**`.
 *
 * The receiver filter is deliberate: `map.delete(k)`, `this.sessions.delete(sid)`
 * and other in-memory container deletes are NOT physical row removal, so only
 * database-handle receivers match (see `DB_RECEIVER_RE`). A continuation line
 * (`await db` / newline / `.delete(...)`) is resolved against the previous
 * non-empty line, so the multi-line Drizzle style is caught too.
 *
 * Baseline, shrink-only. The occurrences that exist on `main` today are recorded
 * in `retained-data-baseline.json` with a per-file COUNT (line numbers are kept
 * as documentation only — they drift with unrelated edits and are never
 * compared). The guard is red when:
 *
 *   • a file has MORE occurrences than its baseline count, or has occurrences
 *     while absent from the baseline  → a NEW regression;
 *   • a file has FEWER occurrences than its baseline count, or a baselined file
 *     is gone   → the baseline is STALE. Removing a baselined occurrence must
 *     update the baseline in the SAME PR, so the baseline can only ever shrink
 *     (the #1278 schema slices drain it as they land).
 *
 * Allowlist (named, not pattern-guessed) — excluded from the physical-delete
 * scan per the #1278 scope boundary:
 *   • `*.spec.ts` / `*.e2e-spec.ts` / `*.test.ts` and `apps/api/test/**` —
 *     isolated test-database teardown, not production data;
 *   • `apps/api/drizzle/**` — migrations history is an immutable record of
 *     already-applied DDL, never rewritten to satisfy a guard;
 *   • `*.fake.ts` — in-memory test doubles (their receivers are containers, so
 *     they would not match anyway; listed so the boundary is explicit).
 *
 * Suppression: a line may carry `// retained-data-ok: <reason>` for a genuinely
 * non-retained table (an ephemeral cache/queue row). The reason is required.
 *
 * Severity: WARN in Phase 0 (ADR-0007 §2.6 new-guard posture; promote to BLOCK
 * once stable). Its `guards-warn` batch step is `continue-on-error`.
 *
 * Run: `pnpm lint:retained-data`. Failures: stderr + exit 1. Clean: exit 0.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";

// TEST SEAM: `LINT_FIXTURE_ROOT` points the scan (and the baseline lookup) at a
// fixture tree (tools/lint/guard-tests). Inert in production — unset, the root
// resolves to the repo root, so runtime behaviour is unchanged.
const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[retained-data]";
const BASELINE_REL = "tools/lint/retained-data-baseline.json";

type Kind = "cascade" | "physicalDelete";

const SCAN: Record<Kind, { globs: string[]; ignore: string[] }> = {
  cascade: {
    globs: ["packages/db/src/schema/**/*.ts"],
    ignore: ["**/node_modules/**", "**/dist/**", "**/*.d.ts"],
  },
  physicalDelete: {
    globs: ["apps/api/src/**/*.ts", "apps/api/scripts/**/*.ts"],
    ignore: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.d.ts",
      // ── named allowlist (see header) ───────────────────────────────────────
      "**/*.spec.ts", // test-database teardown
      "**/*.e2e-spec.ts", // test-database teardown
      "**/*.test.ts", // test-database teardown
      "**/*.fake.ts", // in-memory test doubles
      "apps/api/test/**", // isolated test-database harness
      "apps/api/drizzle/**", // migrations history (immutable applied DDL)
    ],
  },
};

// `onDelete: "cascade"` (either quote style, any spacing).
const CASCADE_RE = /onDelete\s*:\s*["'`]cascade["'`]/i;

// A database-handle receiver immediately before `.delete(` — Drizzle's
// `db.delete(table)` / `tx.delete(table)`. Container deletes (`map.delete`,
// `this.sessions.delete`) deliberately do NOT match.
const DB_RECEIVER = String.raw`(?:^|[^A-Za-z0-9_$.])(?:this\.)?(?:\w*(?:db|tx|trx|conn|client|drizzle|database))`;
const DB_DELETE_RE = new RegExp(`${DB_RECEIVER}\\s*\\.delete\\s*\\(`, "i");
// A continuation line that is ONLY `.delete(` — the receiver sits on the
// previous non-empty line (`await db` ⏎ `  .delete(streamConfig)`).
const CONT_DELETE_RE = /^\s*\.delete\s*\(/;
const RECEIVER_TAIL_RE = new RegExp(`${DB_RECEIVER}\\s*$`, "i");

// Raw SQL physical-removal statements, in a string literal or a `sql` template.
const RAW_SQL_RE =
  /\b(?:DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?\s+\w|DROP\s+TABLE)\b/i;

const SUPPRESS_RE = /\bretained-data-ok\s*:\s*\S/i;

interface BaselineEntry {
  /** Authoritative: how many occurrences this file is allowed to carry. */
  count: number;
  /** Documentation only — line numbers drift and are never compared. */
  sites?: number[];
  reason?: string;
}
type Baseline = Record<Kind, Record<string, BaselineEntry>>;

interface Finding {
  file: string; // repo-relative, forward slashes
  line: number;
  text: string;
}

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

function loadBaseline(): Baseline {
  const path = resolve(REPO_ROOT, BASELINE_REL);
  const empty: Baseline = { cascade: {}, physicalDelete: {} };
  if (!existsSync(path)) return empty; // a fixture tree may carry no baseline
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Baseline>;
  return {
    cascade: raw.cascade ?? {},
    physicalDelete: raw.physicalDelete ?? {},
  };
}

/** Characters that may legally precede a regex literal (vs. a division `/`). */
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "case",
  "delete",
  "void",
  "in",
  "of",
  "new",
  "throw",
  "do",
  "else",
  "yield",
  "await",
]);

function regexAllowedAfter(token: string): boolean {
  if (token === "") return true;
  if (REGEX_PRECEDING_KEYWORDS.has(token)) return true;
  if (/^[A-Za-z0-9_$]/.test(token)) return false; // identifier / literal → division
  return !")]".includes(token);
}

/**
 * Strip block and line comments, preserving line count and column positions, so
 * a path/statement that appears only inside documentation is not flagged.
 *
 * The scan is STRING-AWARE: single/double-quoted strings, template literals
 * (including `${…}` expression re-entry, arbitrarily nested) and regex literals
 * (including character classes) are tracked as their own states, and a `/*` or
 * `//` inside one of them is literal text, not a comment opener. Getting this
 * wrong is not a cosmetic issue — the previous naive stripper entered
 * block-comment mode on the `/*` inside an ordinary glob constant
 * (`const IGNORE = ["apps/api/test/**"]`), never found a closing block-comment
 * terminator, and blanked the WHOLE REST OF THE FILE, so every delete or cascade below
 * that line became a silent false NEGATIVE. The `guard-tests` cases
 * `red-string-glob-*` pin that shape.
 *
 * String and template CONTENT is preserved (not blanked): raw-SQL findings live
 * inside string literals and `sql` templates, which is exactly what
 * `RAW_SQL_RE` matches. The `// retained-data-ok:` suppression is checked
 * against the raw line, not this output.
 */
function stripComments(source: string): string[] {
  const out: string[] = [];
  let line = "";
  type Mode =
    | "code"
    | "line"
    | "block"
    | "single"
    | "double"
    | "template"
    | "regex"
    | "regexClass";
  let mode: Mode = "code";
  // Brace depth in code mode, plus the depths at which each open `${` sits — a
  // `}` at a recorded depth returns to its enclosing template literal.
  let braceDepth = 0;
  const templateStack: number[] = [];
  // The last significant code token (identifier/keyword word or single char),
  // used to disambiguate a regex literal from a division operator.
  let lastToken = "";

  const push = (ch: string): void => {
    if (ch === "\n") {
      out.push(line);
      line = "";
    } else if (ch !== "\r") {
      line += ch;
    }
  };
  // A comment character keeps the layout (newlines still break lines) but the
  // text is dropped.
  const drop = (ch: string): void => {
    if (ch === "\n") {
      out.push(line);
      line = "";
    }
  };

  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    const pair = source.slice(i, i + 2);

    switch (mode) {
      case "code": {
        if (pair === "//") {
          mode = "line";
          i += 2;
          continue;
        }
        if (pair === "/*") {
          mode = "block";
          i += 2;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") {
          mode = ch === '"' ? "double" : ch === "'" ? "single" : "template";
          lastToken = ch;
          push(ch);
          i += 1;
          continue;
        }
        if (ch === "/" && regexAllowedAfter(lastToken)) {
          mode = "regex";
          lastToken = ch;
          push(ch);
          i += 1;
          continue;
        }
        if (ch === "{") braceDepth += 1;
        if (ch === "}") {
          if (
            templateStack.length > 0 &&
            templateStack[templateStack.length - 1] === braceDepth
          ) {
            templateStack.pop();
            mode = "template";
            lastToken = "}";
            push(ch);
            i += 1;
            continue;
          }
          braceDepth -= 1;
        }
        if (/[A-Za-z0-9_$]/.test(ch)) {
          lastToken = /^[A-Za-z0-9_$]/.test(lastToken) ? lastToken + ch : ch;
        } else if (!/\s/.test(ch)) {
          lastToken = ch;
        }
        push(ch);
        i += 1;
        continue;
      }
      case "line": {
        if (ch === "\n") mode = "code";
        drop(ch);
        i += 1;
        continue;
      }
      case "block": {
        if (pair === "*/") {
          mode = "code";
          i += 2;
          continue;
        }
        drop(ch);
        i += 1;
        continue;
      }
      case "single":
      case "double":
      case "template":
      case "regex":
      case "regexClass": {
        if (ch === "\\") {
          push(ch);
          if (i + 1 < source.length) push(source[i + 1]!);
          i += 2;
          continue;
        }
        if (mode === "template" && pair === "${") {
          templateStack.push(braceDepth);
          mode = "code";
          lastToken = "{";
          push("$");
          push("{");
          i += 2;
          continue;
        }
        if (mode === "regex" && ch === "[") {
          mode = "regexClass";
          push(ch);
          i += 1;
          continue;
        }
        if (mode === "regexClass" && ch === "]") {
          mode = "regex";
          push(ch);
          i += 1;
          continue;
        }
        const closes =
          (mode === "single" && ch === "'") ||
          (mode === "double" && ch === '"') ||
          (mode === "template" && ch === "`") ||
          (mode === "regex" && ch === "/");
        // An unterminated single/double-quoted string cannot cross a newline in
        // valid TS — recover at the line break rather than swallowing the file.
        if (ch === "\n" && (mode === "single" || mode === "double")) {
          mode = "code";
          push(ch);
          i += 1;
          continue;
        }
        if (closes) {
          mode = "code";
          lastToken = ch === "/" ? "x" : ch; // a regex literal ends a value
        }
        push(ch);
        i += 1;
        continue;
      }
    }
  }
  out.push(line);
  return out;
}

function previousNonEmpty(lines: string[], idx: number): string {
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (lines[i]!.trim() !== "") return lines[i]!;
  }
  return "";
}

function hit(kind: Kind, code: string[], i: number): boolean {
  const line = code[i]!;
  if (kind === "cascade") return CASCADE_RE.test(line);
  if (RAW_SQL_RE.test(line)) return true;
  if (DB_DELETE_RE.test(line)) return true;
  if (CONT_DELETE_RE.test(line)) {
    return RECEIVER_TAIL_RE.test(previousNonEmpty(code, i).trimEnd());
  }
  return false;
}

async function scan(kind: Kind): Promise<Finding[]> {
  const { globs, ignore } = SCAN[kind];
  const files = await fg(globs, { cwd: REPO_ROOT, ignore, absolute: true });
  const findings: Finding[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const rawLines = source.split(/\r?\n/);
    const code = stripComments(source);
    for (let i = 0; i < code.length; i += 1) {
      if (SUPPRESS_RE.test(rawLines[i] ?? "")) continue;
      if (!hit(kind, code, i)) continue;
      findings.push({
        file: relative(REPO_ROOT, file).replace(/\\/g, "/"),
        line: i + 1,
        text: (rawLines[i] ?? "").trim().slice(0, 120),
      });
    }
  }
  return findings;
}

function groupByFile(findings: Finding[]): Map<string, Finding[]> {
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byFile.get(f.file) ?? [];
    list.push(f);
    byFile.set(f.file, list);
  }
  return byFile;
}

const LABEL: Record<Kind, string> = {
  cascade: "new-cascade",
  physicalDelete: "new-physical-delete",
};

async function main(): Promise<void> {
  const baseline = loadBaseline();
  const errors: string[] = [];
  let baselined = 0;

  for (const kind of ["cascade", "physicalDelete"] as Kind[]) {
    const findings = await scan(kind);
    const byFile = groupByFile(findings);
    const base = baseline[kind];
    baselined += Object.values(base).reduce((n, e) => n + e.count, 0);

    // (1) NEW occurrences — more than baselined, or an unbaselined file.
    for (const [file, list] of byFile) {
      const allowed = base[file]?.count ?? 0;
      if (list.length <= allowed) continue;
      const extra = list.length - allowed;
      const shown = list.slice(allowed);
      errors.push(
        `${TAG} ${LABEL[kind]}  ${file} — ${list.length} occurrence(s), baseline allows ${allowed}\n` +
          shown.map((f) => `    ${file}:${f.line}  ${f.text}`).join("\n") +
          `\n    ${extra} NEW occurrence(s).`,
      );
    }

    // (2) STALE baseline — a baselined file now carries fewer occurrences.
    for (const [file, entry] of Object.entries(base)) {
      const actual = byFile.get(file)?.length ?? 0;
      if (actual >= entry.count) continue;
      errors.push(
        `${TAG} stale-baseline  ${file} — ${actual} occurrence(s) found, baseline claims ${entry.count}.\n` +
          `    A removed occurrence must shrink the baseline in the SAME PR: set "count" to ${actual}` +
          (actual === 0 ? " or drop the entry." : "."),
      );
    }
  }

  info(
    `baseline carries ${baselined} recorded occurrence(s) (${BASELINE_REL})`,
  );

  if (errors.length === 0) {
    info(
      "PASS — no new cascade FK or physical-delete call against retained data, and the baseline is exact.",
    );
    process.exit(0);
  }

  for (const e of errors) process.stderr.write(`${e}\n`);
  process.stderr.write(
    `${TAG} FAIL — ${errors.length} finding(s). Application-owned Postgres data is retained ` +
      `LOGICALLY (soft-delete / status transition), not removed physically (#1278): retained rows ` +
      `back audit, consent and analytics. Replace the physical delete with a soft-delete/status ` +
      `update, or the cascade FK with \`onDelete: "no action"\` plus an explicit lifecycle ` +
      `transition. If the row is genuinely ephemeral (cache/queue), carry ` +
      `\`// retained-data-ok: <reason>\` on the line. If you REMOVED a baselined occurrence, ` +
      `update ${BASELINE_REL} in the same PR — the baseline only ever shrinks.\n`,
  );
  process.exit(1);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});

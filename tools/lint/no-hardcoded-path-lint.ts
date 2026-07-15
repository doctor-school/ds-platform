#!/usr/bin/env tsx
/**
 * tools/lint/no-hardcoded-path-lint.ts — enforcement gate for the "no hardcoded
 * values" Hard rule (AGENTS.md §6) and the dev-stand "never hardcode a
 * host/port/path" rule (`.claude/rules/dev-stand.md`), scoped to committed
 * tooling (#936).
 *
 * Why this exists: PR #933 (`pnpm dispatch:brief` scaffold, #915) baked a
 * machine-specific absolute path literal `C:/Users/sidor/repos/ds-platform/`
 * into `renderBrief()` — TWICE. A hardcoded value standing in for config, it
 * silently breaks every other developer's recipe and violates §6. The rule
 * lived only in prose, so nothing fired at the subagent's edit point and it
 * surfaced a full PR-cycle late at Mode-a. `root_cause: prose-not-enforced` →
 * this deterministic gate.
 *
 * What it flags: an ABSOLUTE, machine-specific path literal in committed
 * `tools/**` `.mjs`/`.ts` runtime code —
 *
 *   1. drive-letter roots — `C:/…`, `C:\…`, `D:\…` (any letter);
 *   2. unix home roots — `/home/<user>/…`, `/Users/<user>/…`;
 *   3. the repo-root path literal in any of its forms — a dev-box
 *      `C:/Users/<user>/…/ds-platform` (case 1) or a Linux/CI
 *      `/home/runner/work/ds-platform/…` (case 2) are both home/drive-rooted, so
 *      the two families above cover it.
 *
 * The sanctioned replacement is deriving the root at runtime via
 * `git rev-parse --show-toplevel` (or a cwd/`os`-derived root) — that produces
 * NO path literal, so such code is inherently clean and never matches.
 *
 * Scope: committed tooling only — the tools tree, `.mjs` / `.ts` files.
 * EXCLUDES the guard-tests harness dir and any `.spec.ts` / `.test.ts`: those
 * legitimately carry fake absolute paths as TEST DATA (e.g. a canned
 * `git rev-parse` stdout `C:/Users/dev/ds-platform`), not runtime config.
 *
 * Comments are documentation, not runtime literals, and are stripped before
 * matching — a header comment noting that `git rev-parse` prints a
 * forward-slash `C:/Users/...` path on Windows is explanatory, not a violation.
 *
 * Suppression: a line may carry `// no-hardcoded-path-ok: <reason>` to
 * acknowledge a genuinely required absolute path (rare). The reason is required.
 *
 * Severity: WARN in Phase 0 (ADR-0007 §2.6 new-guard posture; promote to BLOCK
 * once stable). The CI job uses `continue-on-error`.
 *
 * Run: `pnpm lint:no-hardcoded-path`. Failures: stderr + exit 1. Clean: exit 0.
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
const TAG = "[no-hardcoded-path]";

const GLOBS = ["tools/**/*.{mjs,ts}"];
const IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/guard-tests/**", // the test harness + fixtures use fake paths as test data
  "**/*.spec.ts",
  "**/*.test.ts",
  "**/*.d.ts",
];

// (1) Drive-letter root: a single letter + `:` + slash/backslash + a real path
// segment char (`C:/Users`, `D:\repos`, or the escaped-string `C:\\Users`). Not
// preceded by an alnum (so it is a path root, not part of a longer token), and
// the trailing path char rules out escaped-backtick artefacts like `EARS-N:\``
// (a `:` + `\` + backtick, not a drive path). Allows one or two backslashes so
// a JS-escaped literal `"C:\\Users"` is caught as well as a template `C:\Users`.
const DRIVE_ROOT_RE = /(?<![A-Za-z0-9])[A-Za-z]:[\\/]{1,2}[A-Za-z0-9._]/;
// (2) Unix home root: `/home/<user>/…` or `/Users/<user>/…` — an absolute,
// machine-specific home directory. Requires a non-empty user segment.
const UNIX_HOME_RE = /\/(?:home|Users)\/[^/\s"'`\\]+/;

const SUPPRESS_RE = /\bno-hardcoded-path-ok\s*:/i;

interface Finding {
  file: string;
  line: number;
  text: string;
}

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

/**
 * Strip block (`/* … *\/`) and line (`//…`) comments from source, preserving line
 * count (comment spans become blank), so a path literal that appears only inside
 * a comment (documentation of the sanctioned pattern) is not flagged. Not
 * string-aware — it only ever REMOVES text, so it can never introduce a false
 * positive; a `// no-hardcoded-path-ok:` suppression is checked on the raw line.
 */
function stripComments(source: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of source.split(/\r?\n/)) {
    let line = "";
    let i = 0;
    while (i < raw.length) {
      if (inBlock) {
        const end = raw.indexOf("*/", i);
        if (end === -1) {
          i = raw.length; // rest of line is inside the block comment
        } else {
          i = end + 2;
          inBlock = false;
        }
        continue;
      }
      if (raw.startsWith("//", i)) break; // line comment → drop remainder
      if (raw.startsWith("/*", i)) {
        inBlock = true;
        i += 2;
        continue;
      }
      line += raw[i];
      i += 1;
    }
    out.push(line);
  }
  return out;
}

async function main(): Promise<void> {
  const files = await fg(GLOBS, {
    cwd: REPO_ROOT,
    ignore: IGNORE,
    absolute: true,
  });

  const findings: Finding[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const rawLines = source.split(/\r?\n/);
    const codeLines = stripComments(source);
    codeLines.forEach((code, i) => {
      // Suppression is acknowledged on the raw line (the marker lives in a
      // comment, which `stripComments` would otherwise have removed).
      if (SUPPRESS_RE.test(rawLines[i] ?? "")) return;
      if (DRIVE_ROOT_RE.test(code) || UNIX_HOME_RE.test(code)) {
        findings.push({
          file,
          line: i + 1,
          text: (rawLines[i] ?? "").trim().slice(0, 120),
        });
      }
    });
  }

  info(`scanned ${files.length} committed tools/** source file(s)`);

  if (findings.length === 0) {
    info(
      "PASS — no hardcoded absolute path literals in the committed tools tree.",
    );
    process.exit(0);
  }

  for (const f of findings) {
    const rel = relative(REPO_ROOT, f.file).replace(/\\/g, "/");
    process.stderr.write(
      `${TAG} hardcoded-abs-path  ${rel}:${f.line}\n    ${f.text}\n`,
    );
  }
  process.stderr.write(
    `${TAG} FAIL — ${findings.length} hardcoded absolute path literal(s) in committed tools. ` +
      `A machine-specific drive-letter or home-directory path baked into runtime code is a ` +
      `hardcoded value standing in for config (AGENTS.md §6; ` +
      `dev-stand rule "never hardcode a host/port/path"). Derive the repo root at runtime via ` +
      `\`git rev-parse --show-toplevel\` (or a cwd/os-derived root), or carry ` +
      `\`// no-hardcoded-path-ok: <reason>\` on the line if the absolute path is genuinely required.\n`,
  );
  process.exit(1);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});

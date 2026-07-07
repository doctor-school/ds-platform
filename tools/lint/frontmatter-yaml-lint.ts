#!/usr/bin/env tsx
/**
 * tools/lint/frontmatter-yaml-lint.ts — STATIC tree-scan guard (job
 * `frontmatter-yaml`) for the frontmatter-YAML parse class that broke the docs
 * build post-merge in the #596 wave (Issue #597).
 *
 * ── The failure it catches ────────────────────────────────────────────────────
 * An unquoted `: ` (colon-space) inside a frontmatter block scalar — e.g. a
 * `prior_decisions` list entry `- ADR-0001 … `access: authenticated` …` — makes
 * YAML read the entry as a nested mapping and throw. `pnpm pr:preflight`'s four
 * PR-gated guards do NOT parse frontmatter, so the defect surfaced only when
 * fumadocs compiled the page — i.e. as a CI red + rerun AFTER push
 * (`docs-build` / `build` / `ci` all went red on #596), never at the keyboard.
 *
 * ── The rule (exact) ──────────────────────────────────────────────────────────
 * Every `apps/docs/content/** /*.{md,mdx}` file (fumadocs compiles both) must
 * have a frontmatter block that parses as valid YAML. The guard parses each file
 * with **gray-matter** (js-yaml under the hood) — faithful for the
 * malformed-frontmatter class `docs-build` fails on (fumadocs runs its own
 * parser, so exotic edge-case divergence is possible, but a YAML block that
 * throws here throws there too). A file whose
 * frontmatter YAML throws FAILS with a `<file>:<line>` message (the line is the
 * offending frontmatter line, so a developer can jump straight to it). A file
 * with no frontmatter block, or a well-formed one, passes.
 *
 * ── Static, not PR-gated ──────────────────────────────────────────────────────
 * Needs no PR context, no `gh`, no Nest boot — a pure tree scan. Wired into
 * `pnpm pr:preflight --static` (STATIC_GUARDS) so it runs pre-push alongside the
 * other cheap guards. It carries no dedicated CI job: the `docs-build` job
 * already fails hard-red on this class in CI (fumadocs compile), so this guard is
 * the LOCAL pre-push mirror of that existing gate, not a new CI gate.
 *
 * Seam: `LINT_FIXTURE_ROOT` (guard-tests harness) — inert in production.
 * Run: `pnpm lint:frontmatter-yaml`. Findings: stderr + exit 1. Clean: stdout + exit 0.
 */
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import fg from "fast-glob";

const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[frontmatter-yaml]";

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

/**
 * A js-yaml `YAMLException` carries a `mark` with a 0-based `line`/`column`
 * relative to the frontmatter YAML content. Since the opening `---` is on file
 * line 1 and gray-matter preserves the line count, the offending file line is
 * `mark.line + 1`.
 */
interface YamlMark {
  line?: number;
  column?: number;
}
interface YamlException extends Error {
  mark?: YamlMark;
  reason?: string;
}

/** The offending file line (1-based) from a js-yaml exception mark, or null. */
function fileLine(err: YamlException): number | null {
  const l = err.mark?.line;
  return typeof l === "number" ? l + 1 : null;
}

async function main(): Promise<void> {
  const files = await fg("apps/docs/content/**/*.{md,mdx}", {
    cwd: REPO_ROOT,
    ignore: ["**/node_modules/**"],
  });

  const failures: string[] = [];
  let parsed = 0;
  for (const rel of files) {
    const posix = rel.replace(/\\/g, "/");
    const raw = await readFile(resolve(REPO_ROOT, rel), "utf8");
    try {
      // Same engine as the fumadocs build (gray-matter → js-yaml). A file with no
      // leading `---` block yields empty data without throwing.
      matter(raw);
      parsed += 1;
    } catch (e) {
      const err = e as YamlException;
      const line = fileLine(err);
      const at = line === null ? posix : `${posix}:${line}`;
      const reason = (err.reason ?? err.message ?? String(e)).split("\n")[0];
      failures.push(`${at}  ${reason}`);
    }
  }

  if (failures.length > 0) {
    for (const f of failures) process.stderr.write(`${TAG} ${f}\n`);
    process.stderr.write(
      `${TAG} FAIL — ${failures.length} file(s) have malformed frontmatter YAML. ` +
        `A frontmatter scalar containing \`: \` (colon-space) must be quoted, else ` +
        `YAML reads it as a nested mapping and fumadocs fails to compile the page ` +
        `(the #596 class). Quote the offending value.\n`,
    );
    process.exit(1);
  }

  info(
    `${parsed} doc(s) under apps/docs/content parse cleanly — no malformed frontmatter YAML.`,
  );
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});

/**
 * tools/lint/lib/registry-rows.ts — the row grammar of the checked-in answer
 * key `apps/docs/content/specs/product/two-site-ia/capability-ownership.md`,
 * shared by the #2002 tree checks (tech spec
 * `apps/docs/content/specs/tech/2026-09-07-one-code-two-storefronts-plan-en.md`
 * §3 rule 3; §5 on why the checks travel together).
 *
 * Two guards read that one file — `host-allowlist-lint.ts` («## Host-file
 * allowlist», host `.ts`/`.tsx` files) and `route-mount-lint.ts` («## Route-file
 * registry», Next.js `page`/`layout` files). They must agree on what a row IS,
 * or the answer key grows two dialects and a row that satisfies one guard is
 * invisible to the other. Hence one parser, one `ROW_RE`, one glob rule.
 *
 * Only the span between the requested `## ` heading and the NEXT `## ` heading
 * is read: the `## Registry` table uses brace globs in a different column shape
 * and is not an answer-key row, and the two answer-key sections must not read
 * each other's rows.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The checked-in answer key, repo-relative posix. */
export const REGISTRY_REL =
  "apps/docs/content/specs/product/two-site-ia/capability-ownership.md";

/** Only true glob metacharacters: route groups and dynamic segments are real path text. */
export const GLOB_CHARS_RE = /[*?{}]/;
/** A row is `| <backtick path> | col2 | col3 |`; header and separator rows carry no backticks. */
export const ROW_RE = /^\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*$/;
/** An `until` that names an extraction wave (`wave 1`, `wave 4 (#2073)`). */
export const WAVE_RE = /\bwave\s*\d+/i;

/**
 * A row of an answer-key section. `reason` is the middle column — the human
 * reason in the allowlist, the target `@ds/<name>` package in the route-file
 * registry — and `until` is the lifetime column.
 */
export interface Row {
  path: string;
  reason: string;
  until: string;
}

/**
 * TEST SEAM: `LINT_FIXTURE_ROOT` lets the guard-tests harness point the answer
 * key at a fixture tree. Inert in production — when unset the root resolves to
 * the repo root, so runtime behaviour is unchanged.
 */
export function registryRoot(): string {
  return process.env.LINT_FIXTURE_ROOT
    ? resolve(process.env.LINT_FIXTURE_ROOT)
    : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

/**
 * Parse the rows of one answer-key section. Throws (never exits) so each guard
 * can report the failure under its own tag.
 */
export function parseRegistryRows(sectionHeading: string): Row[] {
  const file = resolve(registryRoot(), REGISTRY_REL);
  if (!existsSync(file)) {
    throw new Error(`answer key not found at ${REGISTRY_REL}`);
  }
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === sectionHeading);
  if (start === -1) {
    throw new Error(`«${sectionHeading}» section missing in ${REGISTRY_REL}`);
  }
  const rows: Row[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith("## ")) break;
    const m = ROW_RE.exec(line.trim());
    if (m) rows.push({ path: m[1].trim(), reason: m[2], until: m[3] });
  }
  return rows;
}

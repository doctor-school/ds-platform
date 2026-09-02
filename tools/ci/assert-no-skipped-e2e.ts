/**
 * #1595 — fail-loud guard over the `api-e2e` CI tier.
 *
 * The tier used to run `vitest` with only `DATABASE_URL` in the environment, so
 * every `describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)`
 * suite (taxonomy, room, registration, recordings, me, …) collapsed to a SKIP
 * and the check-run went green having executed none of them — a blind gate.
 * Provisioning the IdP fixes today's blindness; this guard is what keeps a
 * FUTURE missing variable from going quietly green again.
 *
 * Two assertions, both fail-closed:
 *
 *  1. every variable in `REQUIRED_ENV` is present and non-empty — the direct
 *     inverse of the #1595 root cause;
 *  2. no test in an `apps/api/test` e2e spec was skipped, UNLESS the `skipIf`
 *     conditions guarding THAT TEST are gated on a service this CI tier
 *     deliberately does not provision (`UNPROVISIONED_ENV`) and that variable is
 *     in fact unset. The exemption is read from the spec's own skip conditions,
 *     not from a hand-maintained file list, and it is scoped to the individual
 *     test — each skipped test is attributed to its own `it.skipIf` plus the
 *     `describe.skipIf` blocks enclosing it. A file that mixes gates (the common
 *     shape here: a file-level `!DATABASE_URL || !IDP_ISSUER` describe with an
 *     inner `it.skipIf(!CENTRIFUGO_URL)`) therefore cannot let the inner
 *     unprovisioned gate excuse an IDP- or DATABASE-gated skip.
 *
 * Input: the JSON emitted by `vitest --reporter=json --outputFile=<file>`.
 * Usage: `pnpm ci:assert-e2e-ran <report.json>`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Environment the `api-e2e` job MUST supply for the gated suites to run. */
export const REQUIRED_ENV = [
  "DATABASE_URL",
  "IDP_ISSUER",
  "IDP_SERVICE_TOKEN",
  "IDP_CLIENT_ID",
  "IDP_CLIENT_SECRET",
  "IDP_PROJECT_ID",
] as const;

/**
 * Services the api-e2e tier does NOT stand up (they belong to the dev stand and
 * to the browser tiers): object storage, the realtime bus, the mail/SMS sinks.
 * A suite gated on one of these may legitimately skip here; a suite gated on
 * anything else may not.
 */
export const UNPROVISIONED_ENV = [
  "S3_ENDPOINT",
  "CENTRIFUGO_URL",
  "MAILPIT_URL",
  "SMS_SINK_URL",
] as const;

const E2E_FILE_RE = /apps\/api\/test\/.*\.e2e-spec\.ts$/;
const SKIPPED_STATUSES = new Set(["pending", "skipped", "todo"]);

export interface VitestAssertion {
  readonly fullName?: string;
  readonly title?: string;
  readonly status?: string;
}
export interface VitestFileResult {
  readonly name?: string;
  readonly assertionResults?: readonly VitestAssertion[];
}
export interface VitestReport {
  readonly testResults?: readonly VitestFileResult[];
}

/**
 * Repo-relative, POSIX-separated path — CI is Linux, authoring is Windows, and
 * a report may already carry a relative name (the guard-test fixtures do).
 */
export function toRepoRelative(reported: string, repoRoot: string): string {
  const relative = path.isAbsolute(reported)
    ? path.relative(repoRoot, reported)
    : reported;
  return relative.split(/[\\/]/).join("/");
}

/**
 * A `describe`/`it`/`test` call in a spec source: its title (when it is a plain
 * string literal), the env names its OWN `skipIf` condition reads, and its source
 * range so enclosing blocks can be recovered by containment.
 */
export interface SkipBlock {
  readonly kind: "suite" | "test";
  readonly title: string | undefined;
  readonly env: readonly string[];
  readonly start: number;
  readonly end: number;
}

/** Index of the closing quote of the string literal opening at `start`. */
function endOfString(source: string, start: number): number {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i += 1) {
    const c = source[i];
    if (c === "\\") {
      i += 1;
      continue;
    }
    if (quote === "`" && c === "$" && source[i + 1] === "{") {
      let depth = 0;
      let j = i + 1;
      for (; j < source.length; j += 1) {
        const d = source[j];
        if (d === '"' || d === "'" || d === "`") {
          j = endOfString(source, j);
          continue;
        }
        if (d === "{") depth += 1;
        else if (d === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      i = j;
      continue;
    }
    if (c === quote) return i;
  }
  return source.length - 1;
}

/** Index just past the `)` matching the `(` at `open` (strings/comments aware). */
function endOfCall(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i);
      if (nl < 0) return source.length;
      i = nl;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      i = close < 0 ? source.length : close + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i = endOfString(source, i);
      continue;
    }
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return source.length;
}

/**
 * Module-level `const NAME = …process.env.X…` aliases, resolved one level deep —
 * the `LIVE_IDP` / `CENTRIFUGO_URL` shape several suites use.
 */
function envAliases(source: string): Map<string, string[]> {
  const aliases = new Map<string, string[]>();
  const aliasRe = /const\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*?);/g;
  for (const match of source.matchAll(aliasRe)) {
    const names = [...match[2].matchAll(/process\.env\.([A-Z0-9_]+)/g)].map(
      (m) => m[1],
    );
    if (names.length > 0) aliases.set(match[1], names);
  }
  return aliases;
}

function envNamesIn(
  condition: string,
  aliases: Map<string, string[]>,
): string[] {
  const found = new Set<string>();
  for (const m of condition.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
    found.add(m[1]);
  }
  for (const m of condition.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
    for (const name of aliases.get(m[1]) ?? []) found.add(name);
  }
  return [...found];
}

/** Leading string-literal argument of a call, when it is a plain literal. */
function titleOf(args: string): string | undefined {
  const match = /^\s*(["'])((?:\\.|(?!\1).)*)\1/.exec(args);
  return match?.[2];
}

const CALL_RE = /\b(describe|it|test)((?:\.[A-Za-z]+)*)\s*\(/g;
/** Modifiers that take their own call before the title arguments. */
const CALLABLE_MODIFIERS = new Set(["skipIf", "runIf", "each", "for"]);

/**
 * Every `describe`/`it`/`test` call in a spec, with the env its own `skipIf`
 * reads. Blocks nest by source containment, so a test's full gate is its own env
 * plus that of every block whose range encloses it.
 */
export function parseSkipBlocks(source: string): SkipBlock[] {
  const aliases = envAliases(source);
  const blocks: SkipBlock[] = [];
  for (const match of source.matchAll(CALL_RE)) {
    const start = match.index ?? 0;
    const modifiers = (match[2] ?? "").split(".").filter(Boolean);
    const env: string[] = [];
    let cursor = start + match[0].length - 1;
    let last = modifiers.at(-1);
    let hops = 0;
    while (last !== undefined && CALLABLE_MODIFIERS.has(last) && hops++ < 4) {
      const close = endOfCall(source, cursor);
      if (last === "skipIf" || last === "runIf") {
        env.push(...envNamesIn(source.slice(cursor + 1, close - 1), aliases));
      }
      const rest = source.slice(close);
      const chained = /^\s*((?:\.[A-Za-z]+)+)\s*\(/.exec(rest);
      if (chained) {
        last = (chained[1] ?? "").split(".").filter(Boolean).at(-1);
        cursor = close + chained[0].length - 1;
        continue;
      }
      const args = /^\s*\(/.exec(rest);
      if (!args) {
        cursor = -1;
        break;
      }
      cursor = close + args[0].length - 1;
      break;
    }
    if (cursor < 0) continue;
    const end = endOfCall(source, cursor);
    blocks.push({
      kind: match[1] === "describe" ? "suite" : "test",
      title: titleOf(source.slice(cursor + 1, end - 1)),
      env,
      start,
      end,
    });
  }
  return blocks;
}

/** A block's own env plus that of every block enclosing it. */
function resolvedGate(
  blocks: readonly SkipBlock[],
  block: SkipBlock,
): string[] {
  const gate = new Set(block.env);
  for (const other of blocks) {
    if (other === block) continue;
    if (other.start < block.start && other.end >= block.end) {
      for (const name of other.env) gate.add(name);
    }
  }
  return [...gate];
}

/**
 * Gate candidates for one skipped test — each an independent env set that could
 * explain the skip. A test whose title matches exactly one `it`/`test` in the
 * source is attributed to THAT block's gate (its own `skipIf` plus every
 * enclosing one). A test that cannot be attributed — a dynamic/`each` title, an
 * ambiguous one, a report entry with no matching declaration — falls back to the
 * FILE-LEVEL gates alone, so an inner `it.skipIf` is never credited for it.
 */
export function gateCandidates(
  blocks: readonly SkipBlock[],
  title: string | undefined,
): string[][] {
  const matches = blocks.filter(
    (b) => b.kind === "test" && title !== undefined && b.title === title,
  );
  if (matches.length === 1) return [resolvedGate(blocks, matches[0])];
  const topLevel = blocks.filter(
    (b) => !blocks.some((o) => o !== b && o.start < b.start && o.end >= b.end),
  );
  return topLevel.length > 0 ? topLevel.map((b) => [...b.env]) : [[]];
}

/**
 * A skip is excused only when EVERY gate that could explain it names an
 * unprovisioned service whose variable is in fact unset. One candidate that does
 * not is enough to fail the guard — the exemption is never file-wide.
 */
export function isExemptSkip(
  candidates: readonly string[][],
  env: Record<string, string | undefined>,
): boolean {
  return (
    candidates.length > 0 &&
    candidates.every((gate) =>
      UNPROVISIONED_ENV.some((name) => gate.includes(name) && !env[name]),
    )
  );
}

export interface EvaluateInput {
  readonly report: VitestReport;
  readonly repoRoot: string;
  readonly env: Record<string, string | undefined>;
  /** Reads a spec's source by repo-relative path; `undefined` when unreadable. */
  readonly readSource: (relativePath: string) => string | undefined;
}

export interface EvaluateResult {
  readonly failures: string[];
  readonly executed: number;
  readonly skipped: number;
}

/** Human-readable failure reasons; an empty array means the gate passes. */
export function evaluate({
  report,
  repoRoot,
  env,
  readSource,
}: EvaluateInput): EvaluateResult {
  const failures: string[] = [];

  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length > 0) {
    failures.push(
      `missing required environment for the IDP-gated e2e suites: ${missing.join(", ")}. ` +
        "The api-e2e job must provision Postgres AND the Zitadel IdP (.github/workflows/ci.yml).",
    );
  }

  let executed = 0;
  let skipped = 0;
  for (const file of report.testResults ?? []) {
    const relative = toRepoRelative(file.name ?? "", repoRoot);
    if (!E2E_FILE_RE.test(relative)) continue;

    const assertions = file.assertionResults ?? [];
    const skippedHere = assertions.filter((a) =>
      SKIPPED_STATUSES.has(a.status ?? ""),
    );
    executed += assertions.length - skippedHere.length;
    skipped += skippedHere.length;
    if (skippedHere.length === 0) continue;

    const source = readSource(relative);
    if (source === undefined) {
      failures.push(
        `${relative}: ${skippedHere.length} skipped test(s) and the spec source could not be read to justify them.`,
      );
      continue;
    }
    const blocks = parseSkipBlocks(source);
    const unexplained = skippedHere.filter(
      (a) => !isExemptSkip(gateCandidates(blocks, a.title), env),
    );
    if (unexplained.length > 0) {
      const names = unexplained
        .map((a) => a.fullName ?? a.title ?? "<unnamed test>")
        .slice(0, 5);
      failures.push(
        `${relative}: ${unexplained.length} skipped test(s) with no unprovisioned-service gate — ` +
          `the suite silently did not run: ${names.join(" | ")}`,
      );
    }
  }

  if (executed === 0) {
    failures.push(
      "no api e2e test executed at all — the report contains zero executed " +
        "apps/api/test e2e tests, which cannot be a green gate.",
    );
  }

  return { failures, executed, skipped };
}

export function main(argv: readonly string[]): number {
  const reportArg = argv[2];
  if (!reportArg) {
    console.error(
      "usage: pnpm ci:assert-e2e-ran <vitest-json-report> (tools/ci/assert-no-skipped-e2e.ts)",
    );
    return 1;
  }
  // `LINT_FIXTURE_ROOT` is the repo-wide guard-test seam (tools/lint/guard-tests):
  // it re-roots both the report path and the spec-source lookup at a fixture tree.
  const repoRoot = process.env.LINT_FIXTURE_ROOT
    ? path.resolve(process.env.LINT_FIXTURE_ROOT)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const reportPath = path.resolve(repoRoot, reportArg);

  let report: VitestReport;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8")) as VitestReport;
  } catch (error) {
    console.error(
      `could not read the vitest JSON report at ${toRepoRelative(reportPath, repoRoot)}: ${String(error)}`,
    );
    return 1;
  }

  const { failures, executed, skipped } = evaluate({
    report,
    repoRoot,
    env: process.env,
    readSource: (relative) => {
      try {
        return readFileSync(path.join(repoRoot, relative), "utf8");
      } catch {
        return undefined;
      }
    },
  });

  console.log(
    `api e2e: ${executed} test(s) executed, ${skipped} skipped across the apps/api/test e2e specs`,
  );
  if (failures.length === 0) {
    console.log("assert-no-skipped-e2e: OK");
    return 0;
  }
  console.error("assert-no-skipped-e2e: FAILED");
  for (const failure of failures) console.error(`  - ${failure}`);
  return 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.basename(process.argv[1]) === "assert-no-skipped-e2e.ts";
if (invokedDirectly) {
  process.exit(main(process.argv));
}

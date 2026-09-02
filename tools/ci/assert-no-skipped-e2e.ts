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
 *  2. no test in an `apps/api/test` e2e spec was skipped, UNLESS the suite's own
 *     `skipIf` condition is gated on a service this CI tier deliberately does
 *     not provision (`UNPROVISIONED_ENV`) and that variable is in fact unset.
 *     The exemption is read from the spec's own skip condition, not from a
 *     hand-maintained file list, so a new IDP- or DATABASE-gated skip can never
 *     inherit someone else's exemption.
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
 * Environment variables a spec's `skipIf` conditions depend on. Conditions are
 * read from the source rather than guessed: direct `process.env.NAME` reads
 * plus module-level `const NAME = …process.env.X…` aliases (the `LIVE_IDP` /
 * `CENTRIFUGO_URL` shape several suites use) resolved one level deep.
 */
export function skipConditionEnv(source: string): Set<string> {
  const aliases = new Map<string, string[]>();
  const aliasRe = /const\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*?);/g;
  for (const match of source.matchAll(aliasRe)) {
    const names = [...match[2].matchAll(/process\.env\.([A-Z0-9_]+)/g)].map(
      (m) => m[1],
    );
    if (names.length > 0) aliases.set(match[1], names);
  }

  const found = new Set<string>();
  const skipRe = /(?:describe|it|test)\.skipIf\(([\s\S]*?)\)\s*\(/g;
  for (const match of source.matchAll(skipRe)) {
    const condition = match[1];
    for (const m of condition.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      found.add(m[1]);
    }
    for (const m of condition.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
      for (const name of aliases.get(m[1]) ?? []) found.add(name);
    }
  }
  return found;
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
    const conditionEnv = skipConditionEnv(source);
    const exempt = UNPROVISIONED_ENV.some(
      (name) => conditionEnv.has(name) && !env[name],
    );
    if (!exempt) {
      const names = skippedHere
        .map((a) => a.fullName ?? a.title ?? "<unnamed test>")
        .slice(0, 5);
      failures.push(
        `${relative}: ${skippedHere.length} skipped test(s) with no unprovisioned-service gate — ` +
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

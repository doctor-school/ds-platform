#!/usr/bin/env tsx
/**
 * tools/lint/workflow-auth-lint.ts — WARN v1 meta-guard (job `workflow-auth`) that
 * enforces the "Issue-#10 auth pattern" on `.github/workflows/ci.yml` itself.
 *
 * Implemented per Issue #462 (surfaced by the /wrap retro of the 2026-07-02
 * guard-debt session). Lands as a REAL WARN v1: exits non-zero on findings; the
 * CI job keeps `continue-on-error: true` until its own ADR-0007 §2.6 promotion
 * window matures (clock starts at merge 2026-07-02).
 *
 * ── Why this guard exists (the tribal knowledge it hardens) ───────────────────
 * A ci.yml job that reads PR metadata through the `gh` CLI needs an explicit
 * permission grant + token wiring, because the default `GITHUB_TOKEN` scope under
 * restrictive workflow permissions ("Read repository contents permission only")
 * lacks `pull-requests: read` — so `gh pr view` exits non-zero and the guard
 * fails before its label-skip short-circuit (Issue #10 root cause 1). The
 * canonical fix (the "Issue-#10 pattern", first applied to the `spec-link` job):
 *   1. the JOB carries `permissions: { contents: read, pull-requests: read }`,
 *   2. the invoking STEP carries `GH_TOKEN` + `PR_NUMBER` env.
 * Nothing enforced this: PR #455 shipped three new PR-gated guard jobs WITHOUT the
 * block → all three red on every PR (a "vacuous red" that would have silently
 * blocked their ADR-0007 §2.6 promotion clocks), caught only by a Mode (a)
 * reviewer overriding an incorrect lead brief. This guard makes that failure mode
 * deterministic and local.
 *
 * ── The rule (exact) ──────────────────────────────────────────────────────────
 * Parse `.github/workflows/ci.yml`. A job is "gh-gated" when any of its `run:`
 * steps reaches GitHub through the `gh` CLI — either a bare `gh …` invocation, or
 * a `tools/lint/*.ts` guard from the PR-event-gated set (a guard that imports
 * `tools/lint/lib/gh.ts`), whether invoked by path (`tsx tools/lint/spec-link-lint.ts`)
 * or by its `pnpm lint:<name>` package.json alias. For every gh-gated job the
 * guard asserts:
 *   (a) the JOB carries `permissions.pull-requests` granting read (the key
 *       assertion — the Issue-#10 root cause), AND `permissions.contents`
 *       granting read (the companion in the canonical block);
 *   (b) each gh-gated STEP carries both `GH_TOKEN` and `PR_NUMBER` in its `env`.
 * Any gap is a finding → stderr + exit 1. A clean ci.yml exits 0.
 *
 * ── Derived, not hardcoded ────────────────────────────────────────────────────
 * The PR-event-gated set is DERIVED by scanning `tools/lint/*.ts` for the
 * `./lib/gh` import, and the `lint:<name>` → file map is DERIVED from the root
 * `package.json` scripts. So when a new `gh`-consuming guard + job land, this
 * meta-guard picks them up with no edit here — the set is never a stale literal.
 *
 * ── Empty-state = REAL evaluated emptiness ────────────────────────────────────
 * If ci.yml has no gh-gated job at all, the guard reports "nothing to check"
 * (exit 0) — the same vacuously-green semantics as events-drift / endpoint-authz.
 * On `main` today there are five (spec-link, registry-research, tdd-signal,
 * spec-status-fresh, prior-decisions), all compliant, so it PASSES.
 *
 * ── The guard satisfies its own rule ──────────────────────────────────────────
 * `workflow-auth-lint.ts` neither imports `./lib/gh` nor calls the `gh` CLI, so
 * the `workflow-auth` job is NOT gh-gated and (correctly) needs no auth block.
 *
 * Seam: `LINT_FIXTURE_ROOT` (guard-tests harness) — points the workflow read, the
 * gh-consumer scan, and the script-map read at a fixture tree. Inert in production.
 * Run: `pnpm lint:workflow-auth`. Findings: stderr + exit 1. Clean/empty: stdout + exit 0.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[workflow-auth]";
const WORKFLOW_REL = ".github/workflows/ci.yml";

// A bare `gh` CLI call in a shell `run:` string: the `gh` binary at a command
// boundary (line start, whitespace, or a shell separator) followed by a subcommand
// word — matches `gh pr view`, `… && gh api …`, not `github` / `pnpm ... gh-foo`.
const BARE_GH_RE = /(?:^|[\s;&|(])gh\s+\w/m;
// A `lint:<name>` script token inside a `run:` string (the pnpm alias path).
const LINT_SCRIPT_TOKEN_RE = /\blint:[a-z0-9-]+/g;
// The `./lib/gh` import that marks a guard as a PR-event-gated `gh` consumer.
const GH_IMPORT_RE = /from\s+['"]\.\/lib\/gh['"]/;

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

/**
 * DERIVE the PR-event-gated guard set: the `tools/lint/*.ts` basenames that
 * import `./lib/gh` (i.e. reach GitHub through the shared `gh` accessor).
 */
function deriveGhConsumers(root: string): Set<string> {
  const lintDir = resolve(root, "tools", "lint");
  const out = new Set<string>();
  let files: string[];
  try {
    files = readdirSync(lintDir).filter((f) => f.endsWith(".ts"));
  } catch {
    return out; // no tools/lint in this (fixture) root — nothing to derive
  }
  for (const f of files) {
    try {
      const src = readFileSync(resolve(lintDir, f), "utf8");
      if (GH_IMPORT_RE.test(src)) out.add(f);
    } catch {
      /* unreadable — skip */
    }
  }
  return out;
}

/**
 * DERIVE the `lint:<name>` → guard-file map from the root package.json scripts of
 * the shape `tsx … tools/lint/<file>.ts` (tolerating flags like `--tsconfig …`).
 */
function deriveScriptMap(root: string): Map<string, string> {
  const map = new Map<string, string>();
  let pkg: { scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  } catch {
    return map;
  }
  for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
    const m = cmd.match(/tools\/lint\/([a-z0-9-]+\.ts)/);
    if (m) map.set(name, m[1]);
  }
  return map;
}

/** True when a `run:` string reaches GitHub through the `gh` CLI. */
function stepIsGhGated(
  run: string,
  ghConsumers: Set<string>,
  scriptMap: Map<string, string>,
): boolean {
  if (BARE_GH_RE.test(run)) return true;
  // Direct guard-file reference: `tsx tools/lint/spec-link-lint.ts`.
  for (const file of ghConsumers) if (run.includes(file)) return true;
  // pnpm alias: `pnpm lint:registry-research` → registry-research-lint.ts.
  const tokens = run.match(LINT_SCRIPT_TOKEN_RE) ?? [];
  for (const token of tokens) {
    const file = scriptMap.get(token);
    if (file && ghConsumers.has(file)) return true;
  }
  return false;
}

/** A permission value grants read when it is `read` or the superset `write`. */
function grantsRead(val: unknown): boolean {
  return val === "read" || val === "write";
}

interface Step {
  name?: string;
  run?: string;
  env?: Record<string, unknown>;
}
interface Job {
  permissions?: unknown;
  steps?: Step[];
}

/** A short, stable label for a step in a finding message. */
function stepLabel(step: Step): string {
  if (step.name) return step.name;
  const firstLine = (step.run ?? "").trim().split("\n")[0];
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine;
}

function main(): void {
  const workflowPath = resolve(REPO_ROOT, WORKFLOW_REL);
  let doc: { jobs?: Record<string, Job> };
  try {
    doc = parse(readFileSync(workflowPath, "utf8")) as { jobs?: Record<string, Job> };
  } catch (e) {
    process.stderr.write(
      `${TAG} FAIL — could not read/parse ${WORKFLOW_REL}: ${(e as Error).message.split("\n")[0]}\n`,
    );
    process.exit(1);
  }

  const jobs = doc.jobs ?? {};
  const ghConsumers = deriveGhConsumers(REPO_ROOT);
  const scriptMap = deriveScriptMap(REPO_ROOT);

  info(
    `derived ${ghConsumers.size} PR-event-gated guard(s) from tools/lint/*.ts (./lib/gh consumers): ` +
      `${[...ghConsumers].sort().join(", ") || "(none)"}`,
  );

  const findings: string[] = [];
  let ghGatedJobs = 0;

  for (const [jobName, job] of Object.entries(jobs)) {
    const steps = Array.isArray(job.steps) ? job.steps : [];
    const gatedSteps = steps.filter(
      (s) => typeof s.run === "string" && stepIsGhGated(s.run, ghConsumers, scriptMap),
    );
    if (gatedSteps.length === 0) continue;
    ghGatedJobs++;

    // (a) job-level permissions.
    const perms = job.permissions;
    const permsObj =
      perms && typeof perms === "object" ? (perms as Record<string, unknown>) : undefined;
    if (!grantsRead(permsObj?.["pull-requests"])) {
      findings.push(
        `${jobName}: job is missing \`permissions.pull-requests: read\` (the Issue-#10 root cause — ` +
          `\`gh pr view\` exits non-zero without it)`,
      );
    }
    if (!grantsRead(permsObj?.["contents"])) {
      findings.push(
        `${jobName}: job is missing \`permissions.contents: read\` (companion of the canonical Issue-#10 block)`,
      );
    }

    // (b) per-step env wiring.
    for (const step of gatedSteps) {
      const env = step.env && typeof step.env === "object" ? step.env : {};
      if (!("GH_TOKEN" in env)) {
        findings.push(`${jobName} → step "${stepLabel(step)}": missing \`GH_TOKEN\` env`);
      }
      if (!("PR_NUMBER" in env)) {
        findings.push(`${jobName} → step "${stepLabel(step)}": missing \`PR_NUMBER\` env`);
      }
    }
  }

  if (ghGatedJobs === 0) {
    info(
      "no gh-gated job found in ci.yml (no job runs a `gh` CLI call or a ./lib/gh guard) — nothing to check. " +
        "Bites the moment a job invokes gh or a PR-event-gated guard (Issue #10).",
    );
    process.exit(0);
  }

  if (findings.length === 0) {
    info(
      `PASS — all ${ghGatedJobs} gh-gated job(s) carry the Issue-#10 auth block ` +
        `(job \`permissions.pull-requests: read\` + step \`GH_TOKEN\`/\`PR_NUMBER\`).`,
    );
    process.exit(0);
  }

  for (const f of findings) process.stderr.write(`${TAG} ${f}\n`);
  process.stderr.write(
    `${TAG} FAIL — ${findings.length} auth-wiring gap(s) across ${ghGatedJobs} gh-gated job(s). ` +
      `Every ci.yml job that runs \`gh\` or a PR-event-gated guard MUST carry the Issue-#10 pattern: ` +
      `add \`permissions: { contents: read, pull-requests: read }\` to the job and ` +
      `\`env: { GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}, PR_NUMBER: \${{ github.event.pull_request.number }} }\` ` +
      `to the invoking step (see the \`spec-link\` job — the canonical pattern).\n`,
  );
  process.exit(1);
}

main();

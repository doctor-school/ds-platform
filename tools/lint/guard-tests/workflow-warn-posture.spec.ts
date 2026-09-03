import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * WARN posture lives in the WORKFLOW, not in the merge gate (#1253).
 *
 * ADR-0007 §2.6 requires a WARN guard to be visible and never merge-blocking.
 * The only mechanism that delivers that without lying to the board is the pair
 * of exit codes asserted here:
 *
 *   1. every WARN guard step carries `continue-on-error: true`, so its failure
 *      does not fail the job;
 *   2. the batch's closing step REPORTS the flagged guards to the job summary
 *      and exits 0, so it does not manufacture a failure either.
 *
 * Together they mean a run with WARN findings CONCLUDES SUCCESS — which is the
 * real assertion this file makes, one level up from any classifier: there is no
 * red for `merge-gate.mjs` / `wait-ci-green.mjs` to forgive, so neither carries
 * a name-based exemption, and a FAILED `guards-warn` keeps its one remaining
 * meaning — the batch never executed — and blocks.
 *
 * The corollary is the third assertion: no BLOCK-class step may live in the
 * WARN batch, because `continue-on-error` would swallow it. `primitives-first`
 * encodes severity in its exit code (#1108: WARN classes exit 0, the #828 raw
 * class exits 1), so it belongs to `guards-block`.
 *
 * Line-scanned rather than YAML-parsed on purpose: `@ds/lint-guard-tests`
 * declares only tsx + vitest, and a phantom root-hoisted `yaml` import would be
 * an undeclared dependency. `WORKFLOWS_DIR` overrides the directory so the
 * suite can be pointed at another revision's workflows.
 */
const here = dirname(fileURLToPath(import.meta.url));
const workflowsDir =
  process.env.WORKFLOWS_DIR ?? resolve(here, "../../../.github/workflows");

const read = (file: string) =>
  readFileSync(resolve(workflowsDir, file), "utf8");

/** Extract one job's block: from `  <job>:` to the next 2-space-indented key. */
function jobBlock(src: string, job: string): string {
  const lines = src.split(/\r?\n/);
  const start = lines.findIndex((l) => l === `  ${job}:`);
  if (start === -1) throw new Error(`job '${job}' not found in workflow`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** Split a job block into per-step chunks (`      - name: …` boundaries). */
function steps(block: string): string[] {
  return block
    .split(/\n(?= {6}- (?:name|uses|run):)/)
    .filter((s) => /^ {6}- /.test(s));
}

const warnSteps = (block: string) =>
  steps(block).filter((s) => /^ {6}- name: WARN · /.test(s));

const reportStep = (block: string) =>
  steps(block).find((s) => /^ {6}- name: WARN report/.test(s));

/**
 * Every `exit <token>` in a step, wherever it sits. Deliberately NOT
 * `not.toMatch(/\n\s+exit 1\b/)`: that anchors on a line start, so the common
 * inline forms — `<cmd> || exit 1`, `test -z "$x" && exit 1` — slip straight
 * through, and any code other than 1 (`exit 2`, `exit "$rc"`) is invisible to
 * it. Collecting the codes and asserting they are ALL `0` closes both holes:
 * this spec is the only thing standing between the repo and a silent return of
 * the WARN-blocks-merge posture, so it enumerates rather than spot-checks.
 */
const exitCodes = (step: string): string[] =>
  [...step.matchAll(/\bexit\s+(\S+)/g)].map((m) => m[1]);

/** Assert a batch's closing report step is visible and cannot fail the job. */
function assertReportIsNonBlocking(block: string) {
  const report = reportStep(block);
  expect(report).toBeDefined();
  // `if: always()` is load-bearing for VISIBILITY, not just tidiness: without
  // it the report is SKIPPED whenever an earlier step failed hard (a BLOCK
  // member, or an infra failure), which is precisely the run whose WARN
  // findings a reader most needs summarised.
  expect(report).toMatch(/\n\s+if: always\(\)/);
  expect(exitCodes(report!)).not.toEqual([]); // it must actually exit explicitly
  expect(exitCodes(report!)).toEqual(exitCodes(report!).map(() => "0"));
}

describe("ci.yml `guards-warn` — a WARN-findings run must conclude SUCCESS (#1253)", () => {
  const block = jobBlock(read("ci.yml"), "guards-warn");

  it("EARS-1253.7: every WARN guard step carries `continue-on-error: true`", () => {
    const all = warnSteps(block);
    expect(all.length).toBeGreaterThan(20); // the 23 light-profile WARN guards
    const missing = all
      .filter((s) => !/\n\s+continue-on-error: true\b/.test(s))
      .map((s) => /- name: (.*)/.exec(s)?.[1]);
    expect(missing).toEqual([]);
  });

  it("EARS-1253.8: the closing report step runs always, exits 0, and never manufactures a failure", () => {
    assertReportIsNonBlocking(block);
  });

  it("EARS-1253.9: the job itself is never `continue-on-error` — an infra failure must still fail it", () => {
    // This is what keeps a FAILED check-run meaningful: it can only mean the
    // batch did not run, which the merge gate blocks on.
    expect(block).not.toMatch(/^ {4}continue-on-error:/m);
  });

  it("EARS-1253.10: no BLOCK-class step hides in the WARN batch — `primitives-first` lives in `guards-block`", () => {
    expect(block).not.toContain("primitives-first");
    const blockBatch = jobBlock(read("ci.yml"), "guards-block");
    expect(blockBatch).toContain("lint:primitives-first");
    // …and as a plain step: no `continue-on-error` may soften it there.
    const step = steps(blockBatch).find((s) =>
      s.includes("lint:primitives-first"),
    );
    expect(step).toBeDefined();
    expect(step).not.toMatch(/continue-on-error/);
  });
});

describe("pr-body-guards.yml — same posture, mixed batch (#1253)", () => {
  const block = jobBlock(read("pr-body-guards.yml"), "pr-body-guards");

  it("EARS-1253.11: every WARN guard step carries `continue-on-error: true`", () => {
    const all = warnSteps(block);
    expect(all.length).toBe(7); // registry-research, spec-status-fresh, prior-decisions, spec-deletion, catalog-deletion, epic-autoclose, cross-front-reuse
    const missing = all
      .filter((s) => !/\n\s+continue-on-error: true\b/.test(s))
      .map((s) => /- name: (.*)/.exec(s)?.[1]);
    expect(missing).toEqual([]);
  });

  it("EARS-1253.12: the closing report step runs always and exits 0 — even after the BLOCK member failed", () => {
    assertReportIsNonBlocking(block);
  });

  it("EARS-1253.13: the BLOCK member `spec-link` stays hard — this check-run's red is reserved for it", () => {
    const step = steps(block).find((s) =>
      /- name: spec-link \(BLOCK\)/.test(s),
    );
    expect(step).toBeDefined();
    expect(step).not.toMatch(/continue-on-error/);
  });
});

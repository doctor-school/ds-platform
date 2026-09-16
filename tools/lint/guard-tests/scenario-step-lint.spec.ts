import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/scenario-step-lint.ts` (regression-contour tech
 * spec §6.2, Issue #2067). Each case points the guard's `LINT_FIXTURE_ROOT` seam at a
 * fixture tree under fixtures/scenario-step/<case> and its `LINT_DIFF_NAMESTATUS_FILE`
 * seam at that case's `diff.txt`, so the touched set is declared rather than taken from
 * the real branch.
 *
 * The pair that carries the contract is touched-vs-untouched: the SAME finding class (a
 * navigation outcome step asserting an address with no landing evidence) is a BLOCK in a
 * file this PR wrote and a WARN row in prose that predates the rule (§6.4 severity). The
 * `with-evidence` case is the discriminator on the other side: a `showing` clause, an
 * action step that opens a panel (no address), and a `lands on /` line inside an
 * evidence-bearing Then block must not manufacture a finding.
 */
const GUARD = "scenario-step-lint.ts";
const dir = (name: string) => caseDir("scenario-step", name);

/** Point the diff seam at the case's declared `git diff --name-status` lines. */
const withDiff = (name: string) => ({
  env: { LINT_DIFF_NAMESTATUS_FILE: resolve(dir(name), "diff.txt") },
});

describe("scenario-step-lint", () => {
  it('red: a bare `navigates to "/path"` Then step in a TOUCHED feature file → exit 1', () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("bare-navigation"),
      withDiff("bare-navigation"),
    );
    expect(code).toBe(1);
    expect(stderr).toContain("apps/portal/e2e/features/shell-journey.feature");
    expect(stderr).toContain('the shell navigates to "/account/events"');
    expect(stderr).toContain("assert an ADDRESS with no landing evidence");
  });

  it('red: a bare `Then("… navigates to {string}")` binding in a TOUCHED step file → exit 1', () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("bare-step-definition"),
      withDiff("bare-step-definition"),
    );
    expect(code).toBe(1);
    expect(stderr).toContain("packages/e2e/steps/shell.steps.ts");
    expect(stderr).toContain("the shell navigates to {string}");
  });

  it("warn: the same finding in an UNTOUCHED feature file → exit 0 with a WARN row", () => {
    const { code, stdout } = runGuard(
      GUARD,
      dir("untouched-prose"),
      withDiff("untouched-prose"),
    );
    expect(code).toBe(0);
    expect(stdout).toContain(
      "WARN apps/docs/content/specs/features/008-portal-shell/008-scenarios.feature",
    );
    expect(stdout).toContain("pre-existing bare navigation step");
  });

  it("green: a `lands on … showing …` outcome plus non-asserting steps → exit 0", () => {
    const { code, stdout } = runGuard(
      GUARD,
      dir("with-evidence"),
      withDiff("with-evidence"),
    );
    expect(code).toBe(0);
    expect(stdout).toContain("PASS");
  });
});

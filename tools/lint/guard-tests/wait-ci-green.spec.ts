import { describe, expect, it } from "vitest";

import { classify } from "../../gh/wait-ci-green.mjs";

/**
 * wait-ci-green — unit cover for `tools/gh/wait-ci-green.mjs::classify`, the
 * pure seam behind `pnpm ci:wait`.
 *
 * It answers the same question as `tools/gh/merge-gate.mjs::classifyCheckRuns`
 * ("may this board be merged?") off a DIFFERENT source: `gh pr checks --json
 * name,bucket,state` rows (`bucket` ∈ pass/fail/pending/skipping/cancel) rather
 * than the check-runs API's `status`/`conclusion`. The two MUST agree — two
 * classifiers disagreeing about the same board is worse than the original #1253
 * bug. They agree by both holding the SAME total rule: any non-success terminal
 * check blocks. Severity is expressed upstream, in the guards' exit codes and
 * the workflow's step postures, never by either classifier special-casing a
 * name.
 */
describe("wait-ci-green classify() — baseline board", () => {
  it("treats an empty board as pending (a freshly-opened PR reports no checks for a few seconds)", () => {
    expect(classify([]).state).toBe("pending");
    expect(classify(undefined).state).toBe("pending");
  });

  it("is green when every row is pass/skipping", () => {
    const checks = [
      { name: "ci", bucket: "pass" },
      { name: "db-drift", bucket: "skipping" },
    ];
    expect(classify(checks).state).toBe("green");
  });

  it("is red on a fail or cancel row", () => {
    for (const bucket of ["fail", "cancel"]) {
      const checks = [
        { name: "ci", bucket: "pass" },
        { name: "core", bucket },
      ];
      const verdict = classify(checks);
      expect(verdict.state).toBe("red");
      expect(verdict.red).toEqual(["core"]);
    }
  });
});

/**
 * Parity with `merge-gate.mjs::classifyCheckRuns` (#1253): NEITHER classifier
 * carries a name-based WARN exemption. WARN is made non-blocking in the
 * WORKFLOW (every WARN guard is a `continue-on-error: true` step; the batch's
 * closing step reports and exits 0), so a WARN-findings run concludes SUCCESS
 * and there is no red to forgive. A FAILED `guards-warn` therefore means the
 * batch never executed — which must block, because "the guards never ran" reads
 * exactly like "everything is clean" on the board.
 */
describe("wait-ci-green classify() — no WARN-name exemption (#1253)", () => {
  it("EARS-1253.4: a failed `guards-warn` row BLOCKS — it can only mean the batch never ran", () => {
    const checks = [
      { name: "ci", bucket: "pass" },
      { name: "guards-warn", bucket: "fail" },
    ];
    const verdict = classify(checks);
    expect(verdict.state).toBe("red");
    expect(verdict.red).toEqual(["guards-warn"]);
  });

  it("EARS-1253.5: no row name is exempt — the rule is total, and matches the merge gate", () => {
    for (const name of [
      "guards-warn",
      "guards-warn-v2",
      "guards-block",
      "pr-body-guards",
      "core",
    ]) {
      const checks = [
        { name: "changes", bucket: "pass" },
        { name, bucket: "cancel" },
      ];
      const verdict = classify(checks);
      expect(verdict.state).toBe("red");
      expect(verdict.red).toEqual([name]);
    }
  });

  it("EARS-1253.6: the classifier exposes no WARN channel to reason about", () => {
    const verdict = classify([{ name: "ci", bucket: "pass" }]);
    expect(verdict.state).toBe("green");
    expect(verdict).not.toHaveProperty("warn");
  });
});

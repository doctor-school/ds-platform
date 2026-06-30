import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/submit-pending-lint.ts` (#337). Each case points
 * the guard's `LINT_FIXTURE_ROOT` seam at a fixture tree under
 * fixtures/submit-pending/<case> and asserts the exit code (0 pass / 1 fail) plus a
 * stable substring of the violation message.
 *
 * The defect the #333 Stage-B owner review surfaced: a submit wired
 * `disabled={isSubmitting}` (a valid token combo every prior gate passes) gives NO
 * progress signal and reads as hung. The standard is the shared `Button.loading`
 * affordance driven from the in-flight flag. The non-submit + comment-mask cases prove
 * the guard's precision (a `type="button"` control and a commented-out example must
 * NOT trip it).
 */
const GUARD = "submit-pending-lint.ts";
const dir = (name: string) => caseDir("submit-pending", name);

describe("submit-pending-lint", () => {
  it("green: a submit driving `loading={isSubmitting}` → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
  });

  it("red: a `type=\"submit\"` disabled by isSubmitting with no `loading` → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red"));
    expect(code).toBe(1);
    expect(stderr).toContain("no `loading` prop");
  });

  it("non-submit: a `type=\"button\"` control disabled by isSubmitting → exit 0", () => {
    const { code } = runGuard(GUARD, dir("non-submit"));
    expect(code).toBe(0);
  });

  it("suppressed: a reasoned `submit-pending-ok` marker skips an offending file → exit 0", () => {
    const { code } = runGuard(GUARD, dir("suppressed"));
    expect(code).toBe(0);
  });

  it("comment-mask: the only violation lives in a JS comment — no false positive → exit 0", () => {
    const { code } = runGuard(GUARD, dir("comment-mask"));
    expect(code).toBe(0);
  });
});

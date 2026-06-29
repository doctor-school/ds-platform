import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/form-error-lint.ts` (#339, the #333 Stage-B
 * follow-up). Each case points the guard's `LINT_FIXTURE_ROOT` seam at a fixture
 * tree under fixtures/form-error/<case> and asserts the exit code (0 pass / 1
 * fail) plus a stable substring of the violation message.
 *
 * The defect this guard catches: a form-level submit error hand-typed as a raw
 * `<p role="alert" className="text-xs text-destructive">` on each auth page
 * instead of routing through the `@ds/design-system` `FormError` / `FormMessage`
 * primitive (the owner caught the 6-pages-+-a-block duplication manually during
 * the #333 review; #336 fixed it with the primitive, this guard makes the
 * regression un-mergeable).
 *
 * The comment-mask case is the proof the guard is not fooled by a commented-out
 * example: a `role="alert"` + `text-destructive` that lives ONLY in a JS comment
 * must NOT raise a false positive (the page really routes through the primitive).
 */
const GUARD = "form-error-lint.ts";
const dir = (name: string) => caseDir("form-error", name);

describe("form-error-lint", () => {
  it("app-green: an auth page that routes its error through the `FormError` primitive → exit 0", () => {
    const { code } = runGuard(GUARD, dir("app-green"));
    expect(code).toBe(0);
  });

  it("app-red: a raw `<p role=\"alert\" className=\"…text-destructive\">` error block in app source → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("app-red-raw-alert"));
    expect(code).toBe(1);
    expect(stderr).toContain("hand-rolled form-error block");
  });

  it("app-suppressed: a reasoned `form-error-ok` marker skips the raw block → exit 0", () => {
    const { code } = runGuard(GUARD, dir("app-suppressed"));
    expect(code).toBe(0);
  });

  it("app-comment-mask: the only role=alert+text-destructive lives in a JS comment — no false positive → exit 0", () => {
    const { code } = runGuard(GUARD, dir("app-comment-mask"));
    expect(code).toBe(0);
  });
});

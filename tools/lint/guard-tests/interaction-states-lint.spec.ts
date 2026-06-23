import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/interaction-states-lint.ts` (#286, the #269
 * centerpiece). Each case points the guard's `LINT_FIXTURE_ROOT` seam at a
 * fixture tree under fixtures/interaction-states/<case> and asserts the exit
 * code (0 pass / 1 fail) plus a stable substring of the violation message.
 *
 * The two comment-mask cases (red-css-comment-mask, red-js-comment-mask) are the
 * proof this harness would have caught the original #269 bug: the guard MUST
 * still FAIL when the only matched token lives in a comment.
 */
const GUARD = "interaction-states-lint.ts";
const dir = (name: string) => caseDir("interaction-states", name);

describe("interaction-states-lint", () => {
  it("green: intact layer-1 base-reset + a styled primitive with hover + focus → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
  });

  it("red: a styled clickable with no hover:* affordance → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-missing-hover"));
    expect(code).toBe(1);
    expect(stderr).toContain("no `hover:*` affordance");
  });

  it("red: a styled clickable with no visible keyboard focus → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-missing-focus"));
    expect(code).toBe(1);
    expect(stderr).toContain("no visible keyboard focus");
  });

  it("#269 L1: the only `cursor: pointer` lives in a CSS comment — must NOT be fooled → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-css-comment-mask"));
    expect(code).toBe(1);
    expect(stderr).toContain("cursor: pointer");
  });

  it("#269 L2: the only hover/focus token lives in a JS comment — must NOT be fooled → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-js-comment-mask"));
    expect(code).toBe(1);
    // Either branch (hover or focus) firing proves the commented tokens did not count.
    expect(stderr).toMatch(/no `hover:\*` affordance|no visible keyboard focus/);
  });
});

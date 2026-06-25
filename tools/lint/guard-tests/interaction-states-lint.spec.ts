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

  // ── scope (c): app-level "no raw styled text link" (#325) ──────────────────
  // The coverage gap that let the portal footer ship `<Link className="underline">`
  // with no hover state through green CI (2026-06-25 live review, finding #3).

  it("#325 app-green: DS-`Link`-composed (`asChild`) + bare unstyled <a> links → exit 0", () => {
    const { code } = runGuard(GUARD, dir("app-green"));
    expect(code).toBe(0);
  });

  it("#325 app-red: a raw styled `<a className=…>` text link in app source → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("app-red-raw-anchor"));
    expect(code).toBe(1);
    expect(stderr).toContain("raw `<a className=…>` text link");
  });

  it("#325 app-red: a raw `next/link` `<Link className=…>` text link (defect #3 shape) → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("app-red-raw-nextlink"));
    expect(code).toBe(1);
    expect(stderr).toContain("raw `next/link` `<Link className=…>` text link");
  });

  it("#325 app-suppressed: a reasoned `interaction-states-ok` marker skips the raw link → exit 0", () => {
    const { code } = runGuard(GUARD, dir("app-suppressed"));
    expect(code).toBe(0);
  });
});

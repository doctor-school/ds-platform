import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/aa-contrast-lint.ts` (#402). Each case points the
 * guard's `LINT_FIXTURE_ROOT` seam at a fixture tree under fixtures/aa-contrast/<case>
 * and asserts the exit code (0 pass / 1 fail) plus a stable substring of the violation
 * message.
 *
 * The two pass cases that matter most are the discriminators the issue calls out: a
 * text-LESS `bg-primary` swatch is fine, and the AA-safe `bg-primary-action` fill +
 * full-strength quiet token are fine. The comment-mask case proves a commented
 * occurrence cannot raise a FALSE positive (the inverse risk to interaction-states).
 */
const GUARD = "aa-contrast-lint.ts";
const dir = (name: string) => caseDir("aa-contrast", name);

describe("aa-contrast-lint", () => {
  it("green: AA-safe quiet token + bg-primary-action fill + text-less swatch → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
  });

  it("red (1): an opacity-dimmed `text-*-foreground/NN` utility → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-dimmed-foreground"));
    expect(code).toBe(1);
    expect(stderr).toContain("opacity-dimmed foreground utility");
    expect(stderr).toContain("text-muted-foreground/70");
  });

  it("red (2): a text-bearing raw `bg-primary` fill → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-text-bg-primary"));
    expect(code).toBe(1);
    expect(stderr).toContain("text-bearing `bg-primary` fill");
    expect(stderr).toContain("bg-primary-action");
  });

  it("red (3): `bg-primary-surface` mispaired with `text-primary-foreground` → exit 1", () => {
    // The action-pair foreground repoints to dark ink in `.dark` while the surface
    // stays blue.700 — dark-on-dark (~1.2:1), the #517 review blocker. The paired
    // `text-primary-surface-foreground` (asserted clean in the `green` case) is the fix.
    const { code, stderr } = runGuard(GUARD, dir("red-surface-mispaired"));
    expect(code).toBe(1);
    expect(stderr).toContain("theme-mispaired `bg-primary-surface`");
    expect(stderr).toContain("text-primary-surface-foreground");
  });

  it("pass: a text-LESS `bg-primary` swatch (incl. an opacity tint) → exit 0", () => {
    const { code } = runGuard(GUARD, dir("swatch-textless-green"));
    expect(code).toBe(0);
  });

  it("no-false-positive: anti-patterns living ONLY in comments are stripped → exit 0", () => {
    const { code } = runGuard(GUARD, dir("comment-mask-green"));
    expect(code).toBe(0);
  });

  it("suppressed: a reasoned `aa-contrast-ok` marker skips the file → exit 0", () => {
    const { code } = runGuard(GUARD, dir("suppressed"));
    expect(code).toBe(0);
  });
});

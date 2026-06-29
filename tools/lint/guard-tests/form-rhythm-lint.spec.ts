import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/form-rhythm-lint.ts` (#334, the #333 Stage-B
 * follow-up). Each case points the guard's `LINT_FIXTURE_ROOT` seam at a fixture
 * tree under fixtures/form-rhythm/<case> and asserts the exit code (0 pass / 1
 * fail) plus a stable substring of the violation message.
 *
 * The three defects the #333 owner review surfaced — each a VALID token combo that
 * every prior gate missed: K-1 a reserved always-empty `min-h-5` message slot
 * (over-spacing); a duplicate `formDescriptionId` (a `<FormDescription>` rendered
 * beside a `<FormMessage>` — the PasswordField bug); K-3 a destructive label in the
 * error state ("red mush"). The comment-mask case proves the guard is not fooled by
 * a commented-out counter-example.
 */
const GUARD = "form-rhythm-lint.ts";
const dir = (name: string) => caseDir("form-rhythm", name);

describe("form-rhythm-lint", () => {
  it("green: an inline FormMessage, neutral label, single description id → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
  });

  it("red-reserved-slot (K-1): a `min-h-5` reserved blank line on the message → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-reserved-slot"));
    expect(code).toBe(1);
    expect(stderr).toContain("reserved height");
  });

  it("red-dup-id: a `<FormDescription>` rendered alongside a `<FormMessage>` → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-dup-id"));
    expect(code).toBe(1);
    expect(stderr).toContain("formDescriptionId");
  });

  it("red-label-destructive (K-3): a `text-destructive` token on the label → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-label-destructive"));
    expect(code).toBe(1);
    expect(stderr).toContain("must stay NEUTRAL");
  });

  it("suppressed: a reasoned `form-rhythm-ok` marker skips an offending file → exit 0", () => {
    const { code } = runGuard(GUARD, dir("suppressed"));
    expect(code).toBe(0);
  });

  it("comment-mask: the only violations live in a JS comment — no false positive → exit 0", () => {
    const { code } = runGuard(GUARD, dir("comment-mask"));
    expect(code).toBe(0);
  });
});

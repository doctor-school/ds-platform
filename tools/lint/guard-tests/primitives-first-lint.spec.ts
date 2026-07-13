import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/primitives-first-lint.ts` (#828).
 *
 * The guard closes the #818 gap: a bespoke `hover:`/`active:`/`focus-visible:`
 * utility stack on a RAW interactive element (`<a>`/`<button>`/`<input>`/… or
 * the file's `next/link` default import under ANY alias) in product-app UI
 * source, instead of composing the `@ds/design-system` primitive that owns the
 * interaction contract. Each case points `LINT_FIXTURE_ROOT` at a fixture tree
 * and asserts exit code (0 pass / 1 fail) + a stable message substring.
 *
 * The AC-4 pair (`red-818-before` / `green-818-after`) is the PR #818
 * pre-rework vs post-`5948eee` `/account` RowLink, verbatim.
 */
const GUARD = "primitives-first-lint.ts";
const dir = (name: string) => caseDir("primitives-first", name);

describe("primitives-first-lint", () => {
  it("green: DS-primitive composition (asChild over classless next/link) + unstyled raw tags → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
  });

  it("red: a raw <a> with a bespoke hover/focus-visible stack → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-raw-anchor"));
    expect(code).toBe(1);
    expect(stderr).toContain("raw `<a>` carries a bespoke interaction-state stack");
  });

  it("red: a raw <button> with an arrow-function attribute BEFORE className (bounded-regex trap) → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-raw-button"));
    expect(code).toBe(1);
    expect(stderr).toContain("raw `<button>` carries a bespoke interaction-state stack");
  });

  it("AC-4 red: the #818 pre-rework /account RowLink — aliased next/link `<NextLink className=…hover:…>` → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-818-before"));
    expect(code).toBe(1);
    expect(stderr).toContain("raw `next/link` `<NextLink>` carries a bespoke interaction-state stack");
  });

  it("AC-4 green: the post-5948eee /account RowLink — DS Link asChild owns the canvas-pinned states → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green-818-after"));
    expect(code).toBe(0);
  });

  it("AC-2 green: canvas-pinned hover:bg-muted on a composite row with a reasoned `primitives-first-ok` marker → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green-marker"));
    expect(code).toBe(0);
  });

  it("red: a `primitives-first-ok:` marker WITHOUT a reason does not suppress → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-marker-no-reason"));
    expect(code).toBe(1);
    expect(stderr).toContain("raw `<button>` carries a bespoke interaction-state stack");
  });

  it("green: state-stack tags living only in comments (doc example / commented-out code) → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green-commented-example"));
    expect(code).toBe(0);
  });
});

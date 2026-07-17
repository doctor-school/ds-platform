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
 * pre-rework vs conformant `/account` RowLink shape.
 *
 * #1103 hardened the guard with a second rule (SHELL): an interactive DS
 * primitive (`Button`/`Link`) used as a bare shell whose call-site className
 * rebuilds the look it owns (≥1 STRONG override — border/bg/padding/size/
 * shadow/rounded/text-size; font-weight/colour/positional/state are WEAK), plus
 * `summary`/`details` + `role="button"` added to the raw-interactive set.
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

  it("AC-4 green: the conformant /account RowLink — DsLink owns states, row geometry on the <li> wrapper (no shell) → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green-818-after"));
    expect(code).toBe(0);
  });

  // #1103 WARN classes (SHELL + summary/details/role=button): severity lives in
  // the exit code — findings are PRINTED but the guard EXITS 0 (Phase 0,
  // non-blocking, check-run stays green). Only the #828 raw-state class exits 1.
  it("#1103 WARN: an interactive DS primitive used as a bespoke-look shell (px-4 text-base) → printed, exit 0", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-shell-primitive"));
    expect(code).toBe(0);
    expect(stderr).toContain("used as a bespoke-look shell");
    expect(stderr).toContain("WARN");
  });

  it("#1103 WARN: a lone type-size override on a DS primitive (text-sm) is a shell — proves ≥1 strong, not ≥2 → printed, exit 0", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-shell-textsize"));
    expect(code).toBe(0);
    expect(stderr).toContain("used as a bespoke-look shell");
  });

  it("#1103 green: DS primitives with positional-only + font-weight/colour tweaks (no strong identity) → exit 0, no finding", () => {
    const { code, stderr } = runGuard(GUARD, dir("green-shell-positional"));
    expect(code).toBe(0);
    expect(stderr).not.toContain("used as a bespoke-look shell");
  });

  it("#1103 green: a reasoned `primitives-first-ok` marker suppresses a SHELL finding → exit 0, no finding", () => {
    const { code, stderr } = runGuard(GUARD, dir("green-shell-marker"));
    expect(code).toBe(0);
    expect(stderr).not.toContain("used as a bespoke-look shell");
  });

  it("#1103 WARN: a `primitives-first-ok` marker WITHOUT a reason does not suppress a SHELL finding → printed, exit 0", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-shell-marker-no-reason"));
    expect(code).toBe(0);
    expect(stderr).toContain("used as a bespoke-look shell");
  });

  it("#1103 WARN: a `<summary>` disclosure trigger with a hand-assembled state stack → printed, exit 0", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-summary-details"));
    expect(code).toBe(0);
    expect(stderr).toContain("raw `<summary>` carries a bespoke interaction-state stack");
  });

  it("#1103 WARN: a `role=\"button\"` host with a hand-assembled state stack → printed, exit 0", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-role-button"));
    expect(code).toBe(0);
    expect(stderr).toContain('`role="button"` host carries a bespoke interaction-state stack');
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

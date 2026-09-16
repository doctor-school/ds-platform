import { describe, expect, it } from "vitest";

import { isSuiteSelectionOnly, parseTouchedPaths } from "../lib/diff";

/**
 * `tools/lint/lib/diff.ts` decides the severity of the two §6.4/§6.5 scenario
 * guards, so the one thing it must never do is call an edit to what a scenario
 * covers or asserts a "suite-selection" edit.
 */
const diff = (...lines: string[]) =>
  [
    "diff --git a/x/031-scenarios.feature b/x/031-scenarios.feature",
    "--- a/x/031-scenarios.feature",
    "+++ b/x/031-scenarios.feature",
    "@@ -1,0 +1,1 @@",
    ...lines,
  ].join("\n");

describe("isSuiteSelectionOnly", () => {
  it("a diff of host-tag lines only is a suite-selection edit", () => {
    expect(isSuiteSelectionOnly(diff("+@host:doctor"))).toBe(true);
    expect(isSuiteSelectionOnly(diff("-@host:academy", "+@host:both"))).toBe(
      true,
    );
  });

  it("one scenario line alongside the tag makes it authorship again", () => {
    expect(
      isSuiteSelectionOnly(diff("+@host:doctor", "+  Scenario: A new one")),
    ).toBe(false);
  });

  it("another tag on the same line is NOT suite selection", () => {
    // `@host:doctor @EARS-4` changes coverage, so the file stays touched.
    expect(isSuiteSelectionOnly(diff("+@host:doctor @EARS-4"))).toBe(false);
  });

  it("an empty or undecidable diff leaves the file touched — the strict side", () => {
    expect(isSuiteSelectionOnly(diff())).toBe(false);
    expect(isSuiteSelectionOnly(null)).toBe(false);
  });

  it("the `+++`/`---` headers are never mistaken for changed lines", () => {
    expect(isSuiteSelectionOnly(diff("+@host:both"))).toBe(true);
  });
});

describe("parseTouchedPaths", () => {
  it("keeps the post-change path and drops deletions", () => {
    const set = parseTouchedPaths(
      ["M\ta/one.feature", "D\ta/gone.feature", "R100\ta/old.md\ta/new.md"].join(
        "\n",
      ),
    );
    expect([...set].sort()).toEqual(["a/new.md", "a/one.feature"]);
  });
});

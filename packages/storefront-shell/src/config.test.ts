import { describe, expect, it } from "vitest";

import { SHELL_PRODUCT_DIFFERENCE_FIELDS } from "./config";

/**
 * #2443 — the shell fields whose values may differ between the two storefronts
 * are DECLARED next to the type, each naming the spec clause and the owner
 * decision of its row in 017's «Differences between storefronts» table.
 */
describe("#2443 shell product differences are declared", () => {
  it("017 EARS-1: the manifest lists exactly the header search, with its clause and decision", () => {
    expect(SHELL_PRODUCT_DIFFERENCE_FIELDS.map((entry) => entry.field)).toEqual(
      ["search"],
    );
    for (const entry of SHELL_PRODUCT_DIFFERENCE_FIELDS) {
      expect(entry.spec).toMatch(
        /^apps\/docs\/content\/specs\/features\/\d{3}-[a-z0-9-]+\/\d{3}-requirements-en\.md$/,
      );
      expect(entry.clauses.length).toBeGreaterThan(0);
      for (const clause of entry.clauses) {
        expect(clause).toMatch(/^\d{3} (EARS|LD)-\d+$/);
      }
      expect(entry.decision).toMatch(/#\d+/);
    }
  });
});

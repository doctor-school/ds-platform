import { describe, expect, it } from "vitest";

import { MAIN_LANDMARK_RULES } from "./axe-landmarks";

describe("#2664 main-landmark axe rules", () => {
  it("#2664: enables the three best-practice main-landmark rules a WCAG-tag scan skips", () => {
    expect(Object.keys(MAIN_LANDMARK_RULES).sort()).toEqual([
      "landmark-main-is-top-level",
      "landmark-no-duplicate-main",
      "landmark-one-main",
    ]);
    for (const rule of Object.values(MAIN_LANDMARK_RULES)) {
      expect(rule.enabled).toBe(true);
    }
  });
});

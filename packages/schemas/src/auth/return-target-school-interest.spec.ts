import { describe, expect, it } from "vitest";
import {
  SCHOOL_INTEREST_RETURN_QUERY,
  parseSameOriginReturnTarget,
} from "./return-target.js";

// 023 EARS-7 — a guest's interest capture rides the 021 registration return
// target: the school screen with the closed `capture=interest` marker, which
// the guard keeps (like the land-only marker and the hybrid tab) so the capture
// completes on return; any other value or company still drops the query.
describe("023 EARS-7 — the school-interest return marker", () => {
  it("EARS-7: the guard keeps the school screen with the interest marker", () => {
    expect(SCHOOL_INTEREST_RETURN_QUERY).toBe("capture=interest");
    expect(parseSameOriginReturnTarget("/schools/orto?capture=interest")).toBe(
      "/schools/orto?capture=interest",
    );
    expect(
      parseSameOriginReturnTarget("/schools/orto?capture=interest#top"),
    ).toBe("/schools/orto?capture=interest");
  });

  it("EARS-7: an unknown capture value, a repeat or a foreign param drops the whole query", () => {
    expect(parseSameOriginReturnTarget("/schools/orto?capture=other")).toBe(
      "/schools/orto",
    );
    expect(
      parseSameOriginReturnTarget(
        "/schools/orto?capture=interest&capture=interest",
      ),
    ).toBe("/schools/orto");
    expect(
      parseSameOriginReturnTarget("/schools/orto?capture=interest&next=//evil"),
    ).toBe("/schools/orto");
  });
});

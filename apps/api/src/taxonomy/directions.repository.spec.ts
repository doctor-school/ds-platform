import { describe, expect, it } from "vitest";

import { oppositeDirectionStatus } from "./directions.repository.js";

describe("direction adjacency lifecycle fingerprint", () => {
  it("EARS-13: fingerprints the true opposite endpoint for outgoing and incoming edges", () => {
    const edge = {
      sourceId: "direction-a",
      sourceStatus: "draft" as const,
      adjacentDirectionId: "direction-b",
      adjacentStatus: "published" as const,
    };

    expect(oppositeDirectionStatus("direction-a", edge)).toBe("published");
    expect(oppositeDirectionStatus("direction-b", edge)).toBe("draft");
  });
});

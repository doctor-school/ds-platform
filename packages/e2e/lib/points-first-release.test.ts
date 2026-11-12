import { describe, expect, it } from "vitest";
import { completePointsSnapshot } from "./points-first-release.js";

describe("025 complete refusal evidence", () => {
  it("EARS-35: exposes an orphan key and system-only posting without a journal or person account", async () => {
    const orphanKey = { event_id: "refused#spend.reserve" };
    const systemPosting = {
      event_id: "refused#spend.settle",
      leg: "settle:pul",
    };
    const query = async (sql: string) => ({
      rows: /\bJOIN\b|\bWHERE\b/i.test(sql)
        ? []
        : sql.includes("points_posting_keys")
          ? [orphanKey]
          : sql.includes("points_postings")
            ? [systemPosting]
            : [],
    });
    const result = await completePointsSnapshot({ query });
    expect(result.journal).toEqual([]);
    expect(result.accounts).toEqual([]);
    expect(result.keys).toEqual([orphanKey]);
    expect(result.postings).toEqual([systemPosting]);
  });

  it("EARS-35: exposes a refused registration's orphan hold and obligation", async () => {
    const query = async (sql: string) => ({
      rows: /\bJOIN\b|\bWHERE\b/i.test(sql)
        ? []
        : /points_reserves|points_obligations/.test(sql)
          ? [{ registration_id: "refused" }]
          : [],
    });
    const result = await completePointsSnapshot({ query });
    expect(result.holds).toHaveLength(1);
    expect(result.obligations).toHaveLength(1);
  });
});

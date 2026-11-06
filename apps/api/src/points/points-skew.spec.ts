import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { POINTS_FUTURE_SKEW_MS } from "./points-ledger.service.js";

describe("025 future-skew bound", () => {
  it("025 EARS-27: the service's skew constant equals the 0058 CHECK interval", () => {
    const sql = readFileSync(
      fileURLToPath(
        new URL("../../drizzle/0058_points_ledger.sql", import.meta.url),
      ),
      "utf8",
    );
    const match = sql.match(
      /"points_postings_occurred_at_not_future_check" CHECK \("points_postings"\."occurred_at" <= "points_postings"\."recorded_at" \+ interval '(\d+) day'\)/,
    );
    expect(match).not.toBeNull();
    expect(POINTS_FUTURE_SKEW_MS).toBe(Number(match![1]) * 24 * 60 * 60 * 1000);
  });
});

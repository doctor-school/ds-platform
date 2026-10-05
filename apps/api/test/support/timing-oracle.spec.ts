import { describe, expect, it } from "vitest";
import {
  describeTiming,
  median,
  medianSpread,
  sampleInterleaved,
} from "./timing-oracle.js";

describe("#2591 timing oracle", () => {
  it("takes the median of odd and even samples", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow();
  });

  it("visits classes round-robin, discards the warm-up round, keeps results per class", async () => {
    const order: string[] = [];
    const [a, b, c] = await sampleInterleaved(
      ["A", "B", "C"].map((name) => async (round: number) => {
        order.push(`${name}${round}`);
        return `${name}${round}`;
      }),
    );
    expect(order.slice(0, 6)).toEqual(["A0", "B0", "C0", "A1", "B1", "C1"]);
    expect(order).toHaveLength(18);
    expect(a!.results).toEqual(["A1", "A2", "A3", "A4", "A5"]);
    expect(b!.samples).toHaveLength(5);
    expect(c!.results).not.toContain("C0");
  });

  it("refuses fewer than five rounds", async () => {
    await expect(
      sampleInterleaved([async () => 1], { rounds: 3 }),
    ).rejects.toThrow();
  });

  it("bounds the spread of medians, so one isolated spike does not decide the verdict", () => {
    const flat = { samples: [41, 41, 41, 41, 41], median: 41, results: [] };
    const spike = { samples: [112, 41, 42, 41, 40], median: 41, results: [] };
    expect(medianSpread([flat, spike])).toBe(0);
    expect(describeTiming([spike])).toBe("41.0 [112.0 41.0 42.0 41.0 40.0]");
  });
});

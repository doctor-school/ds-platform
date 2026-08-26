import { describe, expect, it } from "vitest";
import {
  SCALE_STATISTICS_PATH,
  fetchScaleStatistics,
} from "@/lib/statistics";

/**
 * 017 EARS-2 / LD-3 — the single scale-statistics read, with the injected
 * `fetchImpl` seam `lib/session.test.ts` established for this app.
 */
const COMPUTED_AT = "2026-08-26T09:00:00.000Z";

function stubFetch(
  body: unknown,
  init: { status?: number } = {},
): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { impl, calls };
}

describe("017 EARS-2: fetchScaleStatistics", () => {
  it("017 EARS-2.3: reads the counters from ONE public request", async () => {
    const { impl, calls } = stubFetch({
      doctors: 12400,
      specialties: 118,
      eventsPerYear: 86,
      computedAt: COMPUTED_AT,
    });

    const stats = await fetchScaleStatistics(impl);

    expect(calls).toEqual([SCALE_STATISTICS_PATH]);
    expect(stats.doctors).toBe(12400);
    expect(stats.computedAt).toBe(COMPUTED_AT);
    // A counter with no source is ABSENT — never coerced to a zero here.
    expect("lessons" in stats).toBe(false);
  });

  it("017 EARS-2.4: a non-OK status is an error, so the caller renders the error state", async () => {
    const { impl } = stubFetch({}, { status: 503 });
    await expect(fetchScaleStatistics(impl)).rejects.toThrow(/503/);
  });

  it("017 EARS-2.5: a body violating the shared contract is rejected, not half-rendered", async () => {
    // `-1` is not a cardinality and `computedAt` is required: either is a
    // computation bug that must not reach a doctor's screen as a number.
    const { impl } = stubFetch({ doctors: -1, computedAt: COMPUTED_AT });
    await expect(fetchScaleStatistics(impl)).rejects.toThrow();

    const missingInstant = stubFetch({ doctors: 10 });
    await expect(fetchScaleStatistics(missingInstant.impl)).rejects.toThrow();
  });
});

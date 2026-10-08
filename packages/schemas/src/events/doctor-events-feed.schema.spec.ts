import { describe, expect, it } from "vitest";
import { DoctorEventsFeedSchema } from "./doctor-events-feed.schema.js";

/** Wave-2 gate §4.3 D10 — the doctor feed read carries the api's today. */
describe("doctor events feed — the api's today (D10)", () => {
  const feed = {
    tense: "upcoming" as const,
    today: "2026-10-08",
    from: "2026-10-08",
    to: "2026-10-22",
    days: [],
    totalCount: 0,
    nextTo: null,
    nextFrom: null,
    remaining: 0,
    nextBatch: 0,
    targeting: {
      mode: "all" as const,
      specialtyReference: null,
      directionIds: [],
      adjacentDirectionIds: [],
    },
  };

  it("D10: the feed read carries `today` as a МСК calendar day", () => {
    const parsed = DoctorEventsFeedSchema.parse(feed);
    expect(parsed.today).toBe("2026-10-08");
  });

  it("D10: a feed read without `today`, or with a non-day value, is refused", () => {
    const { today: _today, ...noToday } = feed;
    expect(DoctorEventsFeedSchema.safeParse(noToday).success).toBe(false);
    expect(
      DoctorEventsFeedSchema.safeParse({ ...feed, today: "2026-10-08T00:00" })
        .success,
    ).toBe(false);
  });
});

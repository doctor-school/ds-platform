import { describe, expect, it } from "vitest";
import {
  EVENTS_LIVE_REFRESH_SECONDS,
  EventsLiveReadSchema,
  EventLiveStripSchema,
} from "./events-live.schema.js";

/**
 * 019 EARS-6 (#1521) — the portable half of the «Идёт сейчас» contract: what a
 * strip is, that the read is a LIST (empty when nothing is live — wave-2 gate
 * §4.2, D5: one read on both hosts), and that no start instant may travel to a
 * host that could compare it to a clock.
 */
describe("019 EARS-6 events live contract (both hosts)", () => {
  const strip = (over: Record<string, unknown> = {}) => ({
    eventId: "11111111-1111-4111-8111-111111111111",
    slug: "ortho-live",
    title: "Ортобиология: разбор клинических случаев",
    school: "Школа ортобиологии",
    href: "/events/ortho-live/room",
    endsAt: "2026-09-06T17:30:00.000Z",
    presenceCount: 412,
    viewerIsRegistered: true,
    ...over,
  });

  it("EARS-6.1: accepts a resolved strip with the server-decided entry target", () => {
    const parsed = EventLiveStripSchema.safeParse(strip());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.href).toBe("/events/ortho-live/room");
    expect(parsed.data.viewerIsRegistered).toBe(true);
  });

  it("EARS-6.2: reads «nothing live» as an empty list, never as null or an empty strip", () => {
    expect(EventsLiveReadSchema.safeParse([]).success).toBe(true);
    expect(EventsLiveReadSchema.safeParse(null).success).toBe(false);
    expect(EventsLiveReadSchema.safeParse([{}]).success).toBe(false);
    expect(EventsLiveReadSchema.safeParse(strip()).success).toBe(false);
  });

  it("NEW: carries every running эфир as its own strip, in server order", () => {
    const parsed = EventsLiveReadSchema.safeParse([
      strip({ slug: "first" }),
      strip({ slug: "second" }),
      strip({ slug: "third" }),
    ]);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.map((s) => s.slug)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("EARS-6.3: refuses a start instant, so no host can derive liveness from a clock", () => {
    expect(
      EventLiveStripSchema.safeParse(
        strip({ startsAt: "2026-09-06T16:00:00.000Z" }),
      ).success,
    ).toBe(false);
  });

  it("EARS-6.4: rejects a ranking field on the strip", () => {
    expect(EventLiveStripSchema.safeParse(strip({ score: 1 })).success).toBe(
      false,
    );
  });

  it("EARS-6.5: refuses a negative or fractional presence count", () => {
    expect(
      EventLiveStripSchema.safeParse(strip({ presenceCount: -1 })).success,
    ).toBe(false);
    expect(
      EventLiveStripSchema.safeParse(strip({ presenceCount: 1.5 })).success,
    ).toBe(false);
    expect(
      EventLiveStripSchema.safeParse(strip({ presenceCount: 0 })).success,
    ).toBe(true);
  });

  it("EARS-6.6: refuses an end instant that is not a real ISO datetime", () => {
    expect(
      EventLiveStripSchema.safeParse(strip({ endsAt: "20:30" })).success,
    ).toBe(false);
  });

  it("EARS-6.7: publishes a bounded refresh cadence rather than a socket", () => {
    expect(EVENTS_LIVE_REFRESH_SECONDS).toBe(30);
  });
});

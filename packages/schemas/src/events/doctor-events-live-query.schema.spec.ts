import { describe, expect, it } from "vitest";
import { parseDoctorEventsLiveQuery } from "./doctor-events-feed.schema.js";

/**
 * 019 EARS-6 (#2907) — the «Идёт сейчас» read takes the page's APPLIED
 * specialty scope, decoded by the feed's own codec, so the strip and the feed
 * below it never read different scopes.
 */
describe("019 EARS-6 doctor live-strip query", () => {
  it("019 EARS-6: a read with no scope is «моя и смежные», the feed's own default", () => {
    const parsed = parseDoctorEventsLiveQuery({});
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ specialty: "mine-and-adjacent" });
  });

  it("019 EARS-6: `specialty=all` and an explicit pick decode exactly as the feed decodes them", () => {
    expect(parseDoctorEventsLiveQuery({ specialty: "all" }).data).toEqual({
      specialty: "all",
    });
    expect(
      parseDoctorEventsLiveQuery({ specialty: ["101", "102"] }).data,
    ).toEqual({ specialty: ["101", "102"] });
  });

  it("019 EARS-6: the other facets never reach the live read", () => {
    expect(
      parseDoctorEventsLiveQuery({ specialty: "all", format: "online", q: "x" })
        .data,
    ).toEqual({ specialty: "all" });
  });
});

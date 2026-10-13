import { describe, expect, it } from "vitest";
import { parseDoctorEventsLiveQuery } from "./doctor-events-month.schema.js";

/**
 * 019 EARS-6 (#2907) — the «Идёт сейчас» read takes the page's WHOLE applied
 * filter set (the specialty scope and every facet), decoded by the feed's own
 * codec, so the strip and the feed below it never read different filters.
 */
describe("019 EARS-6 doctor live-strip query", () => {
  it("019 EARS-6: a read with no filter names no scope and no facet, the feed's own default (the server resolves it, LD-9 fall-back included)", () => {
    const parsed = parseDoctorEventsLiveQuery({});
    expect(parsed.success).toBe(true);
    expect(parsed.data?.specialty).toBeUndefined();
    expect(parsed.data).toEqual({
      format: [],
      kind: [],
      city: [],
    });
  });

  it("019 EARS-6: `specialty=all` and an explicit pick decode exactly as the feed decodes them", () => {
    expect(parseDoctorEventsLiveQuery({ specialty: "all" }).data).toMatchObject({
      specialty: "all",
    });
    expect(
      parseDoctorEventsLiveQuery({ specialty: ["101", "102"] }).data,
    ).toMatchObject({ specialty: ["101", "102"] });
  });

  it("019 EARS-6: the kind and format facets reach the live read as the feed decodes them", () => {
    expect(
      parseDoctorEventsLiveQuery({ kind: "efir", format: ["online", "hybrid"] })
        .data,
    ).toMatchObject({ kind: ["efir"], format: ["online", "hybrid"] });
  });

  it("019 EARS-6: the title search and the card facets reach the live read too", () => {
    expect(
      parseDoctorEventsLiveQuery({ q: "PRP", nmo: "true", city: "msk" }).data,
    ).toMatchObject({ q: "PRP", nmo: true, city: ["msk"] });
  });

  it("019 EARS-6: the horizon and the view never reach the live read; a malformed facet is refused", () => {
    const parsed = parseDoctorEventsLiveQuery({
      tense: "past",
      from: "2026-01-01",
      view: "month",
      month: "2026-01",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty("tense");
    expect(parsed.data).not.toHaveProperty("from");
    expect(parseDoctorEventsLiveQuery({ format: "teleport" }).success).toBe(
      false,
    );
  });
});

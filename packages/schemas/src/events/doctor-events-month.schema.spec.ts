import { describe, expect, it } from "vitest";
import {
  DoctorEventsMonthGridSchema,
  doctorEventsMonthDayList,
  doctorEventsMonthFacets,
  doctorEventsMonthFirstDay,
  doctorEventsMonthNextFirstDay,
  doctorEventsMonthOf,
  parseDoctorEventsMonthCountsQuery,
  parseDoctorEventsMonthQuery,
} from "./doctor-events-month.schema.js";

/**
 * 019 EARS-4 (#1519) — the portable half of the `MonthGrid` contract: the query
 * codec that must agree with the feed's, and the month arithmetic the grid
 * skeleton is built from.
 */
describe("019 EARS-4 doctor events month contract", () => {
  const grid = (over: Record<string, unknown> = {}) => ({
    month: "2026-09",
    today: "2026-09-02",
    days: doctorEventsMonthDayList("2026-09").map((date) => ({
      date,
      count: 0,
      hasLive: false,
    })),
    entries: [],
    targeting: {
      mode: "targeted" as const,
      specialtyReference: "31.08.36",
      directionIds: ["d1"],
      adjacentDirectionIds: [],
    },
    ...over,
  });

  it("EARS-4.1: decodes the month plus the feed's own facet vocabulary", () => {
    const parsed = parseDoctorEventsMonthQuery({
      month: "2026-09",
      format: ["online", "hybrid"],
      city: "msk,spb",
      nmo: "true",
      free: "0",
      q: "кардио",
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.month).toBe("2026-09");
    // Repeatable + comma forms are the feed codec's, not a second parser's.
    expect(parsed.data.format).toEqual(["online", "hybrid"]);
    expect(parsed.data.city).toEqual(["msk", "spb"]);
    expect(parsed.data.nmo).toBe(true);
    expect(parsed.data.free).toBe(false);
    expect(parsed.data.q).toBe("кардио");
    expect(parsed.data.specialty).toBe("mine-and-adjacent");
  });

  it("EARS-4.2: leaves the month absent so the server, not the client, names the current one", () => {
    const parsed = parseDoctorEventsMonthQuery({});
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.month).toBeUndefined();
    expect(parsed.data.specialty).toBe("mine-and-adjacent");
  });

  it("EARS-4.3: refuses a malformed month rather than guessing one", () => {
    for (const month of ["2026-13", "2026-9", "septembre", "2026-09-01", ""]) {
      const parsed = parseDoctorEventsMonthQuery({ month });
      if (month === "") {
        // An empty value is an absent value, not a malformed one.
        expect(parsed.success).toBe(true);
        continue;
      }
      expect(parsed.success).toBe(false);
    }
  });

  it("EARS-4.4: refuses a malformed facet with the feed's own verdict", () => {
    expect(parseDoctorEventsMonthQuery({ kind: "Not a slug!" }).success).toBe(
      false,
    );
    expect(parseDoctorEventsMonthQuery({ format: "online" }).success).toBe(
      true,
    );
    expect(parseDoctorEventsMonthQuery({ format: "vebinar" }).success).toBe(
      false,
    );
  });

  it("EARS-4.5: hands the API the facet half in the feed read's own shape", () => {
    const parsed = parseDoctorEventsMonthQuery({
      month: "2026-09",
      specialty: "all",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(doctorEventsMonthFacets(parsed.data)).toEqual({
      format: [],
      kind: [],
      specialty: "all",
      city: [],
      nmo: undefined,
      free: undefined,
      q: undefined,
    });
  });

  it("EARS-4.6: enumerates every day of the month, leap February included", () => {
    expect(doctorEventsMonthDayList("2026-09")).toHaveLength(30);
    expect(doctorEventsMonthDayList("2026-02")).toHaveLength(28);
    expect(doctorEventsMonthDayList("2028-02")).toHaveLength(29);
    expect(doctorEventsMonthDayList("2026-12").at(-1)).toBe("2026-12-31");
    expect(doctorEventsMonthNextFirstDay("2026-12")).toBe("2027-01-01");
    expect(doctorEventsMonthFirstDay("2026-09")).toBe("2026-09-01");
    expect(doctorEventsMonthOf("2026-09-02")).toBe("2026-09");
  });

  it("EARS-4.7: rejects a ranking field on the grid envelope", () => {
    expect(DoctorEventsMonthGridSchema.safeParse(grid()).success).toBe(true);
    expect(
      DoctorEventsMonthGridSchema.safeParse(grid({ score: 1 })).success,
    ).toBe(false);
  });

  it("EARS-4.8: refuses a grid whose month is only partially filled", () => {
    const partial = grid();
    partial.days = partial.days.slice(0, 10);
    expect(DoctorEventsMonthGridSchema.safeParse(partial).success).toBe(false);
  });
});

/**
 * Wave-2 entry gate §4.2 (PR 2.5) — the doctor month view on the package grid:
 * the month read names its entries (row 53: pills, live and past state), and a
 * per-month counts read (row 54) takes the year plus the same facets.
 */
describe("019 EARS-4 doctor month entries and per-month counts (wave-2 gate §4.2, PR 2.5)", () => {
  const base = {
    month: "2026-09",
    today: "2026-09-02",
    days: doctorEventsMonthDayList("2026-09").map((date) => ({
      date,
      count: 0,
      hasLive: false,
    })),
    targeting: {
      mode: "all" as const,
      specialtyReference: null,
      directionIds: [],
      adjacentDirectionIds: [],
    },
  };

  it("NEW: the month grid carries the month's entries with their lifecycle state (row 53)", () => {
    const entry = {
      id: "11111111-1111-4111-8111-111111111111",
      slug: "ortho",
      title: "Ортобиология",
      school: "Школа",
      startsAt: "2026-09-01T09:00:00.000Z",
      state: "ended",
      participationFormat: "online",
    };
    expect(
      DoctorEventsMonthGridSchema.safeParse({ ...base, entries: [entry] })
        .success,
    ).toBe(true);
    expect(DoctorEventsMonthGridSchema.safeParse(base).success).toBe(false);
  });

  it("NEW: the counts read decodes the year plus the feed's facets (row 54)", () => {
    const parsed = parseDoctorEventsMonthCountsQuery({
      year: "2026",
      format: "online",
      kind: ["vebinar"],
      specialty: "all",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({
      year: "2026",
      format: ["online"],
      kind: ["vebinar"],
      specialty: "all",
      city: [],
    });
  });

  it("NEW: the counts read refuses a missing or malformed year (row 54)", () => {
    expect(parseDoctorEventsMonthCountsQuery({}).success).toBe(false);
    expect(parseDoctorEventsMonthCountsQuery({ year: "26" }).success).toBe(
      false,
    );
    expect(
      parseDoctorEventsMonthCountsQuery({ year: "2026", format: "radio" })
        .success,
    ).toBe(false);
  });
});

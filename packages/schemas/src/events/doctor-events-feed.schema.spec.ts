import { describe, expect, it } from "vitest";
import {
  DOCTOR_EVENTS_QUERY_YEAR_MAX,
  DOCTOR_EVENTS_QUERY_YEAR_MIN,
  DoctorEventsFeedSchema,
  parseDoctorEventsFeedQuery,
} from "./doctor-events-feed.schema.js";
import { EVENTS_PAGE_QUERY_CODEC } from "./events-page-query.schema.js";

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

/**
 * #2831 — a well-shaped but impossible or out-of-range day is refused by the
 * read's codec (a 400 at the api boundary), while the page URL keeps it so the
 * feed block alone reports the refused read (019 EARS-9).
 */
describe("019 EARS-8.17 doctor events feed — the served calendar days (#2831)", () => {
  it("019 EARS-8.17: an impossible or out-of-range day fails the read's parse", () => {
    for (const raw of [
      { day: "2026-02-31" },
      { from: "2026-02-29" },
      { from: "0001-01-01" },
      { to: "9999-12-31" },
      { from: `${DOCTOR_EVENTS_QUERY_YEAR_MIN - 1}-12-31` },
      { to: `${DOCTOR_EVENTS_QUERY_YEAR_MAX + 1}-01-01` },
    ]) {
      expect(parseDoctorEventsFeedQuery(raw).success, JSON.stringify(raw)).toBe(
        false,
      );
    }
  });

  it("019 EARS-8.17: a real day at either edge of the served years parses", () => {
    for (const raw of [
      { day: "2028-02-29" },
      { from: `${DOCTOR_EVENTS_QUERY_YEAR_MIN}-01-01` },
      { to: `${DOCTOR_EVENTS_QUERY_YEAR_MAX}-12-31` },
    ]) {
      expect(parseDoctorEventsFeedQuery(raw).success, JSON.stringify(raw)).toBe(
        true,
      );
    }
  });

  it("019 EARS-8.17: the response echoes the horizon resolved past the served years", () => {
    // The refusal lives at the request boundary only: upcoming `from=2999-12-31`
    // resolves `to=3000-01-01`, past `to=1900-01-01` resolves `from=1899-12-31`.
    const feed = {
      tense: "upcoming" as const,
      today: "2026-10-08",
      from: `${DOCTOR_EVENTS_QUERY_YEAR_MAX}-12-31`,
      to: `${DOCTOR_EVENTS_QUERY_YEAR_MAX + 1}-01-01`,
      days: [],
      totalCount: 0,
      nextTo: null,
      nextFrom: `${DOCTOR_EVENTS_QUERY_YEAR_MIN - 1}-12-31`,
      remaining: 0,
      nextBatch: 0,
      targeting: {
        mode: "all" as const,
        specialtyReference: null,
        directionIds: [],
        adjacentDirectionIds: [],
      },
    };
    expect(DoctorEventsFeedSchema.safeParse(feed).success).toBe(true);
    expect(
      DoctorEventsFeedSchema.safeParse({
        ...feed,
        from: `${DOCTOR_EVENTS_QUERY_YEAR_MIN - 1}-12-31`,
        to: `${DOCTOR_EVENTS_QUERY_YEAR_MIN}-01-01`,
        nextTo: `${DOCTOR_EVENTS_QUERY_YEAR_MAX + 1}-01-15`,
      }).success,
    ).toBe(true);
  });

  it("019 EARS-9: the page URL keeps a refused day for the read to refuse", () => {
    const parsed = EVENTS_PAGE_QUERY_CODEC.parse({
      from: "0001-01-01",
      view: "month",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.from).toBe("0001-01-01");
    // The shape is still the page's: a non-day voids it as before.
    expect(EVENTS_PAGE_QUERY_CODEC.parse({ from: "12.09.2026" }).success).toBe(
      false,
    );
  });
});

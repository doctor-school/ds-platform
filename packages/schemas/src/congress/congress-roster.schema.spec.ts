import { describe, expect, it } from "vitest";
import {
  CONGRESS_ROSTER_PAGE_SIZE_DEFAULT,
  CONGRESS_ROSTER_PAGE_SIZE_MAX,
  CONGRESS_ROSTER_SEARCH_MAX,
  CongressRosterListSchema,
  CongressRosterQuerySchema,
  CongressRosterRowSchema,
} from "./congress-roster.schema.js";

/**
 * 044 EARS-18 — the contract of the admin roster read, asserted where it is
 * declared. The query arrives from a URL, so every value is a string: these
 * cases fix the coercion, the defaults and the bounds that the controller's
 * `safeParse` turns into a 400, and the row/envelope shape the registrar's
 * screen is allowed to rely on.
 */

const ROW = {
  registrationId: "11111111-1111-4111-8111-111111111111",
  fullName: "Иванова Мария Петровна",
  specialtyName: "Кардиология",
  workplace: "ГКБ №1",
  city: "Москва",
  region: "Москва",
  phone: "+7 (900) 111-22-33",
  email: "a@ds.test",
  registeredAt: "2026-11-01T07:00:00.000Z",
  confirmationMailStatus: "sent" as const,
};

describe("CongressRosterQuerySchema", () => {
  it("044 EARS-18.6: an empty query is the AdminDataList baseline page — page 1, the default size, no search term", () => {
    expect(CongressRosterQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: CONGRESS_ROSTER_PAGE_SIZE_DEFAULT,
    });
  });

  it("044 EARS-18.6.1: the string values a URL carries are coerced to numbers", () => {
    expect(CongressRosterQuerySchema.parse({ page: "3", pageSize: "50" })).toEqual(
      { page: 3, pageSize: 50 },
    );
  });

  it("044 EARS-18.6.2: a page size above the ceiling is refused rather than clamped — the 400 branch of the route", () => {
    expect(
      CongressRosterQuerySchema.safeParse({
        pageSize: String(CONGRESS_ROSTER_PAGE_SIZE_MAX + 1),
      }).success,
    ).toBe(false);
    expect(
      CongressRosterQuerySchema.safeParse({
        pageSize: String(CONGRESS_ROSTER_PAGE_SIZE_MAX),
      }).success,
    ).toBe(true);
  });

  it("044 EARS-18.6.3: page 0, a negative page and a fractional page are refused — a pager coordinate is a whole position", () => {
    for (const page of ["0", "-1", "1.5"]) {
      expect(
        CongressRosterQuerySchema.safeParse({ page }).success,
        `page=${page}`,
      ).toBe(false);
    }
  });

  it("044 EARS-18.6.4: the search term is trimmed and bounded at the 007 admin-list maximum", () => {
    expect(CongressRosterQuerySchema.parse({ q: "  Иванова  " }).q).toBe(
      "Иванова",
    );
    expect(
      CongressRosterQuerySchema.safeParse({
        q: "x".repeat(CONGRESS_ROSTER_SEARCH_MAX),
      }).success,
    ).toBe(true);
    expect(
      CongressRosterQuerySchema.safeParse({
        q: "x".repeat(CONGRESS_ROSTER_SEARCH_MAX + 1),
      }).success,
    ).toBe(false);
  });
});

describe("CongressRosterRowSchema", () => {
  it("044 EARS-18.7: a full row parses with every desk cell present", () => {
    expect(CongressRosterRowSchema.parse(ROW)).toEqual(ROW);
  });

  it("044 EARS-18.7.1: EARS-16 — every answer-derived cell is nullable, so a platform-origin row with nothing to show is still a valid row", () => {
    const empty = {
      ...ROW,
      specialtyName: null,
      workplace: null,
      city: null,
      region: null,
      phone: null,
      email: null,
      confirmationMailStatus: null,
    };
    expect(CongressRosterRowSchema.parse(empty)).toEqual(empty);
  });

  it("044 EARS-18.7.2: fullName is never null — it is the one cell the roster always renders, empty string at worst", () => {
    expect(
      CongressRosterRowSchema.safeParse({ ...ROW, fullName: null }).success,
    ).toBe(false);
    expect(CongressRosterRowSchema.parse({ ...ROW, fullName: "" }).fullName).toBe(
      "",
    );
  });

  it("044 EARS-18.7.3: the confirmation-letter outcome is the EARS-27 pair or nothing — no free-form status leaks onto the row", () => {
    expect(
      CongressRosterRowSchema.safeParse({
        ...ROW,
        confirmationMailStatus: "queued",
      }).success,
    ).toBe(false);
  });
});

describe("CongressRosterListSchema", () => {
  it("044 EARS-18.8: the envelope carries the rows, the page coordinates, the whole-event total and the event header", () => {
    const list = {
      items: [ROW],
      page: 1,
      pageSize: 20,
      total: 1,
      event: {
        id: "22222222-2222-4222-8222-222222222222",
        slug: "congress-2027",
        title: "Конгресс-2027",
        startsAt: "2026-11-20T09:00:00.000Z",
      },
    };
    expect(CongressRosterListSchema.parse(list)).toEqual(list);
  });

  it("044 EARS-18.8.1: an empty roster of a real event is a valid page — zero rows, total zero, header still present", () => {
    const parsed = CongressRosterListSchema.parse({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      event: {
        id: "22222222-2222-4222-8222-222222222222",
        slug: "congress-2027",
        title: "Конгресс-2027",
        startsAt: "2026-11-20T09:00:00.000Z",
      },
    });
    expect(parsed.items).toEqual([]);
    expect(parsed.total).toBe(0);
  });

  it("044 EARS-18.8.2: a negative total is refused — the pager's denominator cannot be less than nothing", () => {
    expect(
      CongressRosterListSchema.safeParse({
        items: [],
        page: 1,
        pageSize: 20,
        total: -1,
        event: {
          id: "22222222-2222-4222-8222-222222222222",
          slug: "congress-2027",
          title: "Конгресс-2027",
          startsAt: "2026-11-20T09:00:00.000Z",
        },
      }).success,
    ).toBe(false);
  });
});

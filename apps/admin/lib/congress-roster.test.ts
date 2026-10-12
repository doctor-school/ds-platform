import { describe, expect, it } from "vitest";
import type { CongressRosterRow } from "@ds/schemas";
import {
  CONGRESS_ROSTER_COLUMNS,
  attendanceFailureKind,
  attendanceFilterQuery,
  congressDayLongLabel,
  congressDayShortLabel,
  congressRosterCells,
  congressRosterRowNumber,
  deskEntryFailure,
  rosterSortAddressIsStale,
  rosterSortFromAddress,
  isRosterSortDefault,
  ROSTER_SORT_DEFAULT,
  rosterSortHref,
  rosterSortKeyOf,
  rosterSortQuery,
  rosterFiltersAppliedCount,
  rosterFiltersFromAddress,
  rosterFiltersHref,
  rosterFiltersQuery,
  rosterRegisteredRange,
  ROSTER_FILTERS_EMPTY,
} from "./congress-roster";
import {
  congressAttendanceUrl,
  congressRosterUrl,
} from "@/providers/data-provider";

/**
 * 044 EARS-21/25 — the pure half of the roster screen. The unit tier is Node-only,
 * so what is asserted here is the projection the page hands to `AdminDataList`:
 * the column order, the № counter across pages, the МСК registration instant and
 * the EMPTY cell an answer-less row carries (EARS-16) — never a placeholder.
 */
const row: CongressRosterRow = {
  registrationId: "7c0e2d0a-2d7c-4a7f-9c55-0a4f2d9b1a01",
  fullName: "Иванова Мария Петровна",
  specialtyName: "Кардиология",
  workplace: "ГКБ №1",
  city: "Москва",
  region: "Москва",
  // The API sends the normalised E.164 value (EARS-29); the cell formats it (EARS-36).
  phone: "+79001112233",
  email: "ivanova@example.test",
  // 09:00 МСК == 06:00Z.
  registeredAt: "2026-11-20T06:00:00.000Z",
  confirmationMailStatus: "sent",
  attendance: [],
};

describe("044 EARS-21 roster projection", () => {
  it("EARS-37: the columns are №, ФИО, специальность, город, телефон, дата регистрации, присутствие", () => {
    expect(CONGRESS_ROSTER_COLUMNS).toEqual([
      "number",
      "fullName",
      "specialtyName",
      "city",
      "phone",
      "registeredAt",
      "attendance",
    ]);
  });

  it("EARS-25: № is a row counter that continues across server pages", () => {
    expect(congressRosterRowNumber({ page: 1, pageSize: 20 }, 0)).toBe(1);
    expect(congressRosterRowNumber({ page: 1, pageSize: 20 }, 19)).toBe(20);
    expect(congressRosterRowNumber({ page: 3, pageSize: 20 }, 0)).toBe(41);
    expect(congressRosterRowNumber({ page: 2, pageSize: 1 }, 0)).toBe(2);
  });

  it("EARS-37: a full row renders exactly the visible cells, the registration instant in МСК", () => {
    const cells = congressRosterCells(row);
    expect(Object.keys(cells)).toEqual([
      "fullName",
      "specialtyName",
      "city",
      "phone",
      "registeredAt",
    ]);
    expect(cells.fullName).toBe("Иванова Мария Петровна");
    expect(cells.specialtyName).toBe("Кардиология");
    expect(cells.phone).toBe("+7 (900) 111-22-33");
    expect(cells.registeredAt).toContain("09:00");
    expect(cells.registeredAt).not.toContain("06:00");
  });

  it("EARS-16: an answer-less row renders empty cells, never a placeholder", () => {
    const cells = congressRosterCells({
      ...row,
      specialtyName: null,
      workplace: null,
      city: null,
      region: null,
      phone: null,
      email: null,
      confirmationMailStatus: null,
    });
    for (const key of ["specialtyName", "city", "phone"] as const) {
      expect(cells[key]).toBe("");
    }
    expect(cells.fullName).toBe("Иванова Мария Петровна");
  });

  it("EARS-21: the screen reads the roster route with its search and server page, nothing else", () => {
    const id = "10000000-0000-4000-8000-000000000001";
    expect(congressRosterUrl.list(id, { q: "", page: 1, pageSize: 20 })).toBe(
      `/v1/admin/events/${id}/roster?page=1&pageSize=20`,
    );
    expect(
      congressRosterUrl.list(id, { q: "Иванова", page: 2, pageSize: 1 }),
    ).toBe(
      `/v1/admin/events/${id}/roster?q=%D0%98%D0%B2%D0%B0%D0%BD%D0%BE%D0%B2%D0%B0&page=2&pageSize=1`,
    );
  });
});

describe("044 EARS-34 attendance per congress day", () => {
  const id = "7c0e2d0a-2d7c-4a7f-9c55-0a4f2d9b1a02";

  it("EARS-34: a congress day reads «23.04» on the box and «23 апреля» in its accessible name", () => {
    expect(congressDayShortLabel("2027-04-23")).toBe("23.04");
    expect(congressDayShortLabel("2027-12-01")).toBe("01.12");
    expect(congressDayLongLabel("2027-04-23")).toBe("23 апреля");
    expect(congressDayLongLabel("2027-05-01")).toBe("1 мая");
  });

  it("EARS-34: the presence filter sends a day, and a presence only together with that day", () => {
    expect(attendanceFilterQuery({ day: "", presence: "" })).toEqual({});
    expect(attendanceFilterQuery({ day: "", presence: "marked" })).toEqual({});
    expect(attendanceFilterQuery({ day: "2027-04-23", presence: "" })).toEqual({
      attendanceDay: "2027-04-23",
    });
    expect(
      attendanceFilterQuery({ day: "2027-04-23", presence: "unmarked" }),
    ).toEqual({ attendanceDay: "2027-04-23", present: "unmarked" });
  });

  it("EARS-34: the roster GET composes the presence filter with search and paging", () => {
    expect(
      congressRosterUrl.list(id, {
        q: "Иванова",
        page: 1,
        pageSize: 20,
        attendanceDay: "2027-04-23",
        present: "marked",
      }),
    ).toBe(
      `/v1/admin/events/${id}/roster?q=%D0%98%D0%B2%D0%B0%D0%BD%D0%BE%D0%B2%D0%B0&page=1&pageSize=20&attendanceDay=2027-04-23&present=marked`,
    );
  });

  it("EARS-34: one registration's mark for one day is one PUT resource", () => {
    expect(congressAttendanceUrl("congress-2027", id, "2027-04-23")).toBe(
      `/v1/admin/events/congress-2027/registrations/${id}/attendance/2027-04-23`,
    );
  });

  it("EARS-34/38: a refused mark is told apart — withdrawn grant, IdP outage, anything else", () => {
    expect(attendanceFailureKind(403)).toBe("forbidden");
    expect(attendanceFailureKind(401)).toBe("forbidden");
    expect(attendanceFailureKind(503)).toBe("unavailable");
    expect(attendanceFailureKind(0)).toBe("unavailable");
    expect(attendanceFailureKind(404)).toBe("failed");
    expect(attendanceFailureKind(422)).toBe("failed");
    expect(attendanceFailureKind(500)).toBe("failed");
  });
});

describe("044 EARS-35 — the desk entry's refusal classes", () => {
  it("EARS-35: builds the desk route in the one url map", () => {
    expect(congressRosterUrl.deskRegistration("kongress-2026")).toBe(
      "/v1/admin/events/kongress-2026/registrations",
    );
  });

  it("EARS-35: a 403 grant refusal is a withdrawn grant — never retried", () => {
    for (const errorCode of [
      "EVENT_REGISTRAR_REQUIRED",
      "PLATFORM_ADMIN_REQUIRED",
    ]) {
      expect(
        deskEntryFailure({ statusCode: 403, errorCode, message: "x" }),
      ).toBe("grantWithdrawn");
    }
  });

  it("EARS-35: a 403 EVENT_BINDING_REQUIRED (the event binding withdrawn or re-pointed, EARS-38) is a withdrawn grant — never retried", () => {
    for (const errorCode of ["EVENT_BINDING_REQUIRED"]) {
      expect(
        deskEntryFailure({ statusCode: 403, errorCode, message: "x" }),
      ).toBe("grantWithdrawn");
    }
  });

  it("EARS-35: a 503 revalidation outage is retryable, with its own sentence", () => {
    expect(
      deskEntryFailure({
        statusCode: 503,
        errorCode: "IDP_REVALIDATION_UNAVAILABLE",
        message: "x",
      }),
    ).toBe("revalidationUnavailable");
  });

  it("EARS-35: a server refusal of the missing paper consent names the consent", () => {
    expect(
      deskEntryFailure({
        statusCode: 400,
        message: "x",
        fieldErrors: [{ path: "paperConsent", message: "Invalid input" }],
      }),
    ).toBe("noConsent");
  });

  it("EARS-35: unknown event, closed event, other 403 and network faults are the generic refusal", () => {
    expect(deskEntryFailure({ statusCode: 404, message: "x" })).toBe("generic");
    expect(deskEntryFailure({ statusCode: 422, message: "x" })).toBe("generic");
    expect(
      deskEntryFailure({
        statusCode: 403,
        errorCode: "CSRF_INVALID",
        message: "x",
      }),
    ).toBe("generic");
    expect(deskEntryFailure(new TypeError("Failed to fetch"))).toBe("generic");
  });
});

describe("044 EARS-22 server sort state", () => {
  it("EARS-22: no sort in the address reads as the server default — registration date ascending", () => {
    expect(rosterSortFromAddress(new URLSearchParams(""), "")).toEqual({
      key: "registeredAt",
      direction: "asc",
    });
  });

  it("EARS-22: a sort in the address is read back; an unknown key or direction falls back to the default", () => {
    expect(
      rosterSortFromAddress(new URLSearchParams("sort=fullName&dir=desc"), ""),
    ).toEqual({ key: "fullName", direction: "desc" });
    expect(
      rosterSortFromAddress(new URLSearchParams("sort=email&dir=asc"), ""),
    ).toEqual({ key: "registeredAt", direction: "asc" });
    expect(
      rosterSortFromAddress(new URLSearchParams("sort=city&dir=sideways"), ""),
    ).toEqual({ key: "registeredAt", direction: "asc" });
  });

  it("EARS-37: the presence sort holds only while a congress day is chosen — without one it is the default", () => {
    const address = new URLSearchParams("sort=presence&dir=desc");
    expect(rosterSortFromAddress(address, "2026-04-23")).toEqual({
      key: "presence",
      direction: "desc",
    });
    expect(rosterSortFromAddress(address, "")).toEqual({
      key: "registeredAt",
      direction: "asc",
    });
  });

  it("EARS-37: an address sort the screen does not honour — presence after a reload drops the day, an unknown key — is stale and gets rewritten to the default", () => {
    const presence = new URLSearchParams("sort=presence&dir=desc");
    expect(rosterSortAddressIsStale(presence, "")).toBe(true);
    expect(rosterSortAddressIsStale(presence, "2026-04-23")).toBe(false);
    expect(
      rosterSortAddressIsStale(new URLSearchParams("sort=email&dir=asc"), ""),
    ).toBe(true);
    expect(
      rosterSortAddressIsStale(new URLSearchParams("sort=city&dir=desc"), ""),
    ).toBe(false);
    // No sort in the address is the default by definition — nothing to rewrite.
    expect(rosterSortAddressIsStale(new URLSearchParams("q=x"), "")).toBe(
      false,
    );
  });

  it("EARS-22: a sort change is written into the address, keeping the rest of the query (the open card, the search)", () => {
    expect(
      rosterSortHref("/events/e1/roster", "q=%D0%98&registration=r1", {
        key: "phone",
        direction: "desc",
      }),
    ).toBe("/events/e1/roster?q=%D0%98&registration=r1&sort=phone&dir=desc");
  });

  it("EARS-22: going back to the default order takes the sort out of the address, keeping the rest of the query", () => {
    expect(
      rosterSortHref(
        "/events/e1/roster",
        "q=%D0%98&sort=phone&dir=desc&registration=r1",
        ROSTER_SORT_DEFAULT,
      ),
    ).toBe("/events/e1/roster?q=%D0%98&registration=r1");
    expect(
      rosterSortHref("/events/e1/roster", "sort=city&dir=desc", {
        key: "registeredAt",
        direction: "asc",
      }),
    ).toBe("/events/e1/roster");
  });

  it("EARS-22: only registration date ascending is the default order", () => {
    expect(isRosterSortDefault({ key: "registeredAt", direction: "asc" })).toBe(
      true,
    );
    expect(
      isRosterSortDefault({ key: "registeredAt", direction: "desc" }),
    ).toBe(false);
    expect(isRosterSortDefault({ key: "fullName", direction: "asc" })).toBe(
      false,
    );
  });

  it("EARS-22: the visible columns map onto the route's sort keys; № carries none, presence only with a day", () => {
    expect(rosterSortKeyOf("fullName", "")).toBe("fullName");
    expect(rosterSortKeyOf("specialtyName", "")).toBe("specialty");
    expect(rosterSortKeyOf("city", "")).toBe("city");
    expect(rosterSortKeyOf("phone", "")).toBe("phone");
    expect(rosterSortKeyOf("registeredAt", "")).toBe("registeredAt");
    expect(rosterSortKeyOf("number", "2026-04-23")).toBeUndefined();
    expect(rosterSortKeyOf("attendance", "")).toBeUndefined();
    expect(rosterSortKeyOf("attendance", "2026-04-23")).toBe("presence");
  });

  it("EARS-22: the roster GET carries the sort beside search, the presence filter and the page", () => {
    expect(
      congressRosterUrl.list("e1", {
        q: "",
        page: 1,
        pageSize: 20,
        attendanceDay: "2026-04-23",
        ...rosterSortQuery({ key: "presence", direction: "desc" }),
      }),
    ).toBe(
      "/v1/admin/events/e1/roster?page=1&pageSize=20&attendanceDay=2026-04-23&sort=presence&dir=desc",
    );
  });
});

/**
 * 044 EARS-23 — the per-column roster filters (owner layout F1, #2316): one pure
 * mapper between the address, the screen state and the roster GET.
 */
describe("044 EARS-23 roster column filters", () => {
  const SPECIALTY = "6f1c2b9e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";

  it("044 EARS-23: reads every filter from the address, trimmed; an unknown value reads as no filter", () => {
    const filters = rosterFiltersFromAddress(
      new URLSearchParams(
        `name=%20Иванова%20&workplace=ГКБ&city=Химки&region=Московская%20область&phone=926&email=mail.ru&specialtyId=${SPECIALTY}&mailStatus=failed&registeredFrom=2026-10-01&registeredTo=2026-10-15&q=x&sort=city`,
      ),
    );
    expect(filters).toEqual({
      name: "Иванова",
      workplace: "ГКБ",
      city: "Химки",
      region: "Московская область",
      phone: "926",
      email: "mail.ru",
      specialtyId: SPECIALTY,
      mailStatus: "failed",
      registeredFrom: "2026-10-01",
      registeredTo: "2026-10-15",
    });
    expect(
      rosterFiltersFromAddress(
        new URLSearchParams(
          "mailStatus=bounced&specialtyId=not-a-uuid&registeredFrom=01.10.2026",
        ),
      ),
    ).toEqual(ROSTER_FILTERS_EMPTY);
  });

  it("044 EARS-23: writes the filters into the address, dropping blanks and keeping the rest of the query", () => {
    expect(
      rosterFiltersHref(
        "/events/e1/roster",
        "sort=city&dir=desc&name=old&registration=r1",
        { ...ROSTER_FILTERS_EMPTY, workplace: " ГКБ ", city: "Химки" },
      ),
    ).toBe(
      "/events/e1/roster?sort=city&dir=desc&registration=r1&workplace=%D0%93%D0%9A%D0%91&city=%D0%A5%D0%B8%D0%BC%D0%BA%D0%B8",
    );
    expect(
      rosterFiltersHref("/events/e1/roster", "name=x", ROSTER_FILTERS_EMPTY),
    ).toBe("/events/e1/roster");
  });

  it("044 EARS-23: sends only applied filters, never a digit-less phone", () => {
    expect(rosterFiltersQuery(ROSTER_FILTERS_EMPTY)).toEqual({});
    expect(
      rosterFiltersQuery({
        ...ROSTER_FILTERS_EMPTY,
        name: "Иван",
        phone: "+ (",
        mailStatus: "none",
        specialtyId: SPECIALTY,
      }),
    ).toEqual({ name: "Иван", mailStatus: "none", specialtyId: SPECIALTY });
    expect(
      rosterFiltersQuery({ ...ROSTER_FILTERS_EMPTY, phone: "8 926" }),
    ).toEqual({ phone: "8 926" });
  });

  it("044 EARS-23: an inverted date range is sent in order, never as the route's 400", () => {
    expect(
      rosterFiltersQuery({
        ...ROSTER_FILTERS_EMPTY,
        registeredFrom: "2026-10-15",
        registeredTo: "2026-10-01",
      }),
    ).toEqual({ registeredFrom: "2026-10-01", registeredTo: "2026-10-15" });
    expect(
      rosterFiltersQuery({ ...ROSTER_FILTERS_EMPTY, registeredTo: "2026-10-01" }),
    ).toEqual({ registeredTo: "2026-10-01" });
  });

  it("044 EARS-23: counts applied filters for the toggle badge — the date range is one filter", () => {
    expect(rosterFiltersAppliedCount(ROSTER_FILTERS_EMPTY)).toBe(0);
    expect(
      rosterFiltersAppliedCount({
        ...ROSTER_FILTERS_EMPTY,
        specialtyId: SPECIALTY,
        workplace: "ГКБ",
        phone: "(",
        registeredFrom: "2026-10-01",
        registeredTo: "2026-10-15",
      }),
    ).toBe(3);
  });

  it("044 EARS-23: the date-range chip reads in Moscow days, ordered, with open ends", () => {
    expect(
      rosterRegisteredRange({
        ...ROSTER_FILTERS_EMPTY,
        registeredFrom: "2026-10-15",
        registeredTo: "2026-10-01",
      }),
    ).toEqual({ from: "01.10.2026", to: "15.10.2026" });
    expect(
      rosterRegisteredRange({ ...ROSTER_FILTERS_EMPTY, registeredFrom: "2026-10-01" }),
    ).toEqual({ from: "01.10.2026", to: "" });
    expect(rosterRegisteredRange(ROSTER_FILTERS_EMPTY)).toBeNull();
  });
});

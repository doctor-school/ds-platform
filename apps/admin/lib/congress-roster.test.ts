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
} from "./congress-roster";
import { congressAttendanceUrl, congressRosterUrl } from "@/providers/data-provider";

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
  phone: "+7 (900) 111-22-33",
  email: "ivanova@example.test",
  // 09:00 МСК == 06:00Z.
  registeredAt: "2026-11-20T06:00:00.000Z",
  confirmationMailStatus: "sent",
  attendance: [],
};

const mailLabel = (status: "sent" | "failed") =>
  status === "sent" ? "Отправлено" : "Не отправлено";

describe("044 EARS-21 roster projection", () => {
  it("EARS-25/34: the columns are №, ФИО, специальность, место работы, город, область, телефон, email, дата регистрации, статус письма, присутствие", () => {
    expect(CONGRESS_ROSTER_COLUMNS).toEqual([
      "number",
      "fullName",
      "specialtyName",
      "workplace",
      "city",
      "region",
      "phone",
      "email",
      "registeredAt",
      "confirmationMailStatus",
      "attendance",
    ]);
  });

  it("EARS-25: № is a row counter that continues across server pages", () => {
    expect(congressRosterRowNumber({ page: 1, pageSize: 20 }, 0)).toBe(1);
    expect(congressRosterRowNumber({ page: 1, pageSize: 20 }, 19)).toBe(20);
    expect(congressRosterRowNumber({ page: 3, pageSize: 20 }, 0)).toBe(41);
    expect(congressRosterRowNumber({ page: 2, pageSize: 1 }, 0)).toBe(2);
  });

  it("EARS-21: a full row renders every cell, the registration instant in МСК", () => {
    const cells = congressRosterCells(row, mailLabel);
    expect(cells.fullName).toBe("Иванова Мария Петровна");
    expect(cells.specialtyName).toBe("Кардиология");
    expect(cells.phone).toBe("+7 (900) 111-22-33");
    expect(cells.registeredAt).toContain("09:00");
    expect(cells.registeredAt).not.toContain("06:00");
    expect(cells.confirmationMailStatus).toBe("Отправлено");
  });

  it("EARS-16: an answer-less row renders empty cells, never a placeholder", () => {
    const cells = congressRosterCells(
      {
        ...row,
        specialtyName: null,
        workplace: null,
        city: null,
        region: null,
        phone: null,
        email: null,
        confirmationMailStatus: null,
      },
      mailLabel,
    );
    for (const key of [
      "specialtyName",
      "workplace",
      "city",
      "region",
      "phone",
      "email",
      "confirmationMailStatus",
    ] as const) {
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
    expect(attendanceFilterQuery({ day: "2027-04-23", presence: "" })).toEqual(
      { attendanceDay: "2027-04-23" },
    );
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

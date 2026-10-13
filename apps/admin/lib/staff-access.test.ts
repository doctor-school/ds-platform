import { describe, expect, it, vi } from "vitest";
import type { StaffAccessRow } from "@ds/schemas";
import {
  fetchStaffAccessEventPage,
  grantFormIssues,
  grantOutcome,
  grantRefusal,
  grantRequestOf,
  STAFF_ACCESS_GRANT_ENDPOINT,
  STAFF_ACCESS_GRANTS_PATH,
  staffAccessCells,
  staffAccessRoleLabelKey,
  staffAccessRowKey,
  staffAccessRoleTakesEvent,
} from "./staff-access";

const EVENT_ID = "0b8c2f1e-2f7a-4a39-9d0e-6f3a1c2b4d5e";

const ADMIN_ROW: StaffAccessRow = {
  userId: "sub-1",
  fullName: "Иванова Анна Сергеевна",
  email: "ivanova@example.ru",
  role: "platform_admin",
  eventId: null,
  eventTitle: null,
};
const REGISTRAR_ROW: StaffAccessRow = {
  userId: "sub-2",
  fullName: "Петров Пётр",
  email: "petrov@example.ru",
  role: "event-registrar",
  eventId: EVENT_ID,
  eventTitle: "Конгресс 2027",
};

describe("047 EARS-2 «Доступы» — the list rows", () => {
  it("047 EARS-2: a row reads ФИО, почта, the RU role label and the event (empty for platform_admin)", () => {
    expect(staffAccessCells(ADMIN_ROW)).toEqual({
      fullName: "Иванова Анна Сергеевна",
      email: "ivanova@example.ru",
      roleKey: "staffAccess.roles.platform_admin",
      event: "",
    });
    expect(staffAccessCells(REGISTRAR_ROW)).toEqual({
      fullName: "Петров Пётр",
      email: "petrov@example.ru",
      roleKey: "staffAccess.roles.event-registrar",
      event: "Конгресс 2027",
    });
    expect(
      staffAccessCells({ ...ADMIN_ROW, fullName: null, email: null }),
    ).toMatchObject({ fullName: "", email: "" });
  });

  it("047 EARS-2: one row per person, role and event — the key carries all three", () => {
    expect(staffAccessRowKey(ADMIN_ROW)).toBe("sub-1:platform_admin:");
    expect(staffAccessRowKey(REGISTRAR_ROW)).toBe(
      `sub-2:event-registrar:${EVENT_ID}`,
    );
  });

  it("047 EARS-2: every grantable role has its RU label key", () => {
    expect(staffAccessRoleLabelKey("platform_admin")).toBe(
      "staffAccess.roles.platform_admin",
    );
    expect(staffAccessRoleLabelKey("event-registrar")).toBe(
      "staffAccess.roles.event-registrar",
    );
    expect(staffAccessRoleLabelKey("congress-program-committee")).toBe(
      "staffAccess.roles.congress-program-committee",
    );
  });
});

describe("047 EARS-3 grant form — the request it sends", () => {
  it("047 EARS-3: «Мероприятие» belongs to the two congress roles only", () => {
    expect(staffAccessRoleTakesEvent("event-registrar")).toBe(true);
    expect(staffAccessRoleTakesEvent("congress-program-committee")).toBe(true);
    expect(staffAccessRoleTakesEvent("platform_admin")).toBe(false);
    expect(staffAccessRoleTakesEvent("")).toBe(false);
  });

  it("047 EARS-3: an empty or malformed field is refused at the form, naming each field", () => {
    expect(
      grantFormIssues({ email: "", fullName: "", role: "", eventId: "" }),
    ).toEqual({
      email: "required",
      fullName: "required",
      role: "required",
    });
    expect(
      grantFormIssues({
        email: "not-an-email",
        fullName: "Иванова",
        role: "event-registrar",
        eventId: "",
      }),
    ).toEqual({ email: "email", fullName: "fullName", eventId: "event" });
    expect(
      grantFormIssues({
        email: "a@b.ru",
        fullName: "Иванова Анна",
        role: "platform_admin",
        eventId: "",
      }),
    ).toEqual({});
  });

  it("047 EARS-3: the request carries the event only for a congress role", () => {
    expect(
      grantRequestOf({
        email: " Ivanova@Example.RU ",
        fullName: "  Иванова   Анна ",
        role: "platform_admin",
        eventId: EVENT_ID,
      }),
    ).toEqual({
      email: "ivanova@example.ru",
      fullName: "Иванова Анна",
      role: "platform_admin",
    });
    expect(
      grantRequestOf({
        email: "a@b.ru",
        fullName: "Иванова Анна",
        role: "congress-program-committee",
        eventId: EVENT_ID,
      }),
    ).toEqual({
      email: "a@b.ru",
      fullName: "Иванова Анна",
      role: "congress-program-committee",
      eventId: EVENT_ID,
    });
    expect(
      grantRequestOf({
        email: "a@b.ru",
        fullName: "Иванова",
        role: "platform_admin",
        eventId: "",
      }),
    ).toBeNull();
  });

  it("047 EARS-8: the step-up endpoint names the grant route the console sends", () => {
    expect(STAFF_ACCESS_GRANTS_PATH).toBe("/v1/admin/staff-access/grants");
    expect(STAFF_ACCESS_GRANT_ENDPOINT).toBe(
      "POST /v1/admin/staff-access/grants",
    );
  });
});

describe("047 EARS-3/4/5/6 grant answers", () => {
  it("047 EARS-6: a temporary password in the answer is shown once; without one the role was added to an existing account", () => {
    expect(
      grantOutcome({ row: ADMIN_ROW, temporaryPassword: "Xy7-secret-pw" }),
    ).toEqual({ kind: "password", password: "Xy7-secret-pw", row: ADMIN_ROW });
    expect(grantOutcome({ row: ADMIN_ROW })).toEqual({
      kind: "existing",
      row: ADMIN_ROW,
    });
    expect(grantOutcome({ nope: true })).toBeNull();
  });

  const context = {
    email: "petrov@example.ru",
    rows: [ADMIN_ROW, REGISTRAR_ROW],
  };

  it("047 EARS-3: an existing account with an unverified email is its own refusal", () => {
    expect(
      grantRefusal(
        {
          statusCode: 409,
          errorCode: "STAFF_GRANT_EMAIL_UNVERIFIED",
          message: "the email of this account is not verified",
        },
        context,
      ),
    ).toEqual({ kind: "unverified" });
  });

  it("047 EARS-3: an email several accounts share is its own refusal", () => {
    expect(
      grantRefusal(
        { statusCode: 409, errorCode: "STAFF_GRANT_EMAIL_AMBIGUOUS" },
        context,
      ),
    ).toEqual({ kind: "ambiguous" });
  });

  it("047 EARS-3: a registrar bound elsewhere is named with the event it is bound to", () => {
    expect(
      grantRefusal(
        { statusCode: 409, errorCode: "REGISTRAR_BOUND_ELSEWHERE" },
        context,
      ),
    ).toEqual({ kind: "boundElsewhere", eventTitle: "Конгресс 2027" });
    expect(
      grantRefusal(
        { statusCode: 409, errorCode: "REGISTRAR_BOUND_ELSEWHERE" },
        { email: "PETROV@example.ru", rows: [REGISTRAR_ROW] },
      ),
    ).toEqual({ kind: "boundElsewhere", eventTitle: "Конгресс 2027" });
    expect(
      grantRefusal(
        { statusCode: 409, errorCode: "REGISTRAR_BOUND_ELSEWHERE" },
        { email: "other@example.ru", rows: [REGISTRAR_ROW] },
      ),
    ).toEqual({ kind: "boundElsewhere", eventTitle: null });
  });

  it("047 EARS-3: the other refusals map to their own messages", () => {
    const of = (error: unknown) => grantRefusal(error, context);
    expect(
      of({ statusCode: 409, errorCode: "GRANT_ALREADY_COMPLETE" }),
    ).toEqual({ kind: "alreadyComplete" });
    expect(of({ statusCode: 422, errorCode: "EVENT_NOT_FOUND" })).toEqual({
      kind: "eventNotFound",
    });
    expect(of({ statusCode: 503 })).toEqual({ kind: "unavailable" });
    expect(
      of({ statusCode: 403, errorCode: "PLATFORM_ADMIN_REQUIRED" }),
    ).toEqual({ kind: "forbidden" });
    expect(of({ statusCode: 400 })).toEqual({ kind: "invalid" });
    expect(of({ statusCode: 500 })).toEqual({ kind: "generic" });
    expect(of(new Error("network"))).toEqual({ kind: "generic" });
  });

  it("047 EARS-8: a step-up refusal carries the code screen it sends the operator to", () => {
    expect(
      grantRefusal(
        {
          statusCode: 401,
          errorCode: "STEP_UP_REQUIRED",
          stepUpUrl: "/mfa/challenge?mode=reverify",
        },
        context,
      ),
    ).toEqual({ kind: "stepUp", stepUpUrl: "/mfa/challenge?mode=reverify" });
  });
});

describe("047 EARS-3 «Мероприятие» — the event selector's server page", () => {
  it("047 EARS-3: events are searched on the admin list, labelled by title and МСК date", async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: EVENT_ID,
                slug: "congress-2027",
                title: "Конгресс 2027",
                startsAt: "2027-04-23T07:00:00.000Z",
              },
            ],
            total: 30,
            page: 2,
            pageSize: 25,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const page = await fetchStaffAccessEventPage(
      { q: " конгр ", page: 2, pageSize: 25 },
      fetchImpl,
    );
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      `/v1/admin/events?page=2&pageSize=25&q=${encodeURIComponent("конгр")}`,
    );
    expect(init).toMatchObject({ credentials: "include" });
    expect(page.total).toBe(30);
    expect(page.page).toBe(2);
    expect(page.data[0]).toMatchObject({
      id: EVENT_ID,
      title: "Конгресс 2027",
    });
    expect(page.data[0]!.label).toMatch(/^Конгресс 2027 · 23 апреля 2027/);
  });

  it("047 EARS-3: a refused event read fails the selector", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({}), { status: 403 }),
    );
    await expect(
      fetchStaffAccessEventPage({ q: "", page: 1, pageSize: 25 }, fetchImpl),
    ).rejects.toThrow();
  });
});

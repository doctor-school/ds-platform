import { afterEach, describe, expect, it, vi } from "vitest";
import { dataProvider, fetchEligibleExpertUsers } from "./data-provider";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("fetchEligibleExpertUsers", () => {
  it("EARS-23: requests page 2 only after the caller explicitly asks, never by page-walk", async () => {
    const fetchStub = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "00000000-0000-4000-8000-000000000001",
                displayName: "Иван Петров",
                identifier: "doctor@example.test",
              },
            ],
            page: 1,
            pageSize: 25,
            total: 101,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    globalThis.fetch = fetchStub as unknown as typeof fetch;

    const first = await fetchEligibleExpertUsers({
      currentExpertId: "00000000-0000-4000-8000-000000000002",
      q: "  Петров  ",
      page: 1,
      pageSize: 25,
    });

    expect(first.total).toBe(101);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub).toHaveBeenCalledWith(
      "/v1/admin/experts/eligible-users?page=1&pageSize=25&q=%D0%9F%D0%B5%D1%82%D1%80%D0%BE%D0%B2&currentExpertId=00000000-0000-4000-8000-000000000002",
      { credentials: "include", headers: { accept: "application/json" } },
    );

    await fetchEligibleExpertUsers({
      currentExpertId: "00000000-0000-4000-8000-000000000002",
      q: "Петров",
      page: 2,
      pageSize: 25,
    });
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(fetchStub).toHaveBeenLastCalledWith(
      "/v1/admin/experts/eligible-users?page=2&pageSize=25&q=%D0%9F%D0%B5%D1%82%D1%80%D0%BE%D0%B2&currentExpertId=00000000-0000-4000-8000-000000000002",
      { credentials: "include", headers: { accept: "application/json" } },
    );
  });
});

/**
 * #1593 — the 007 events surface answers a refusal with `{ code, message }`,
 * while the 012 taxonomy surface answers `{ errorCode, … }` (the envelope
 * deviation recorded at `DEBT.md:79`). Both are shapes this ONE provider hands to
 * `taxonomyErrorKey`, which keys off `errorCode` — so a body that names its code
 * `code` must not arrive as an unmapped failure, or every events refusal
 * collapses into the generic sentence. Caught on the live stand, not by a unit
 * test that had encoded the wrong wire shape.
 */
describe("dataProvider.custom — refusal envelopes (#1593)", () => {
  async function refusalFrom(body: unknown, status: number): Promise<unknown> {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    return dataProvider.custom!({
      url: "/v1/admin/events/evt-1/publish",
      method: "post",
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
  }

  it("EARS-7: a 412 in the 007 `code` envelope surfaces as a mapped errorCode", async () => {
    const error = (await refusalFrom(
      {
        code: "PRECONDITION_FAILED",
        message: "the event changed since it was read; reload and retry",
      },
      412,
    )) as { errorCode?: string; statusCode?: number };

    expect(error.errorCode).toBe("PRECONDITION_FAILED");
    expect(error.statusCode).toBe(412);
  });

  it("EARS-7: a 428 in the 012 `errorCode` envelope keeps working", async () => {
    const error = (await refusalFrom(
      { errorCode: "PRECONDITION_REQUIRED", detail: "no validator" },
      428,
    )) as { errorCode?: string };

    expect(error.errorCode).toBe("PRECONDITION_REQUIRED");
  });

  it("047 EARS-8: a STEP_UP_REQUIRED refusal carries the stepUpUrl the operator re-elevates at", async () => {
    const error = (await refusalFrom(
      {
        errorCode: "STEP_UP_REQUIRED",
        stepUpUrl: "/mfa/challenge?mode=reverify",
        title: "Fresh step-up verification required",
        status: 401,
      },
      401,
    )) as { errorCode?: string; stepUpUrl?: string; statusCode?: number };

    expect(error.statusCode).toBe(401);
    expect(error.errorCode).toBe("STEP_UP_REQUIRED");
    expect(error.stepUpUrl).toBe("/mfa/challenge?mode=reverify");
  });

  it("EARS-7: `errorCode` wins when a body carries both", async () => {
    const error = (await refusalFrom(
      { errorCode: "IDEMPOTENCY_KEY_REUSED", code: "SOMETHING_ELSE" },
      409,
    )) as { errorCode?: string };

    expect(error.errorCode).toBe("IDEMPOTENCY_KEY_REUSED");
  });
});

describe("dataProvider.create — legacy broadcasts (014 EARS-24, #1741)", () => {
  it("014 EARS-24.3: legacy-broadcasts create posts JSON with Idempotency-Key and no origin/state", async () => {
    const fetchStub = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "evt-legacy-1" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    );
    globalThis.fetch = fetchStub as unknown as typeof fetch;

    const result = await dataProvider.create({
      resource: "legacy-broadcasts",
      variables: {
        title: "Архивный эфир",
        school: "",
        heldAtMsk: "2024-03-01T18:00",
        durationMin: 90,
        description: "",
        speakers: [{ name: "Докладчик", regalia: "" }],
        specialties: [],
        recording: {
          kind: "edited",
          provider: "rutube",
          embedRef: "a".repeat(32),
        },
      },
    });

    expect((result.data as unknown as { id: string }).id).toBe("evt-legacy-1");
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/v1/admin/legacy-broadcasts");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["idempotency-key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain("origin");
    expect(Object.keys(body)).not.toContain("state");
    expect(Object.keys(body)).not.toContain("partnerRef");
    expect(Object.keys(body)).not.toContain("programPdf");
    expect(body.heldAtMsk).toBe("2024-03-01T18:00");
  });
});

describe("dataProvider — the event-kind resource (012 EARS-25, #2509)", () => {
  function stub(body: unknown, status = 200) {
    const fetchStub = vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
    );
    globalThis.fetch = fetchStub as unknown as typeof fetch;
    return fetchStub;
  }

  it("012 EARS-25: the kind list reads /v1/admin/event-kinds with the shared taxonomy query", async () => {
    const fetchStub = stub({ data: [], total: 0, page: 1, pageSize: 20 });
    await dataProvider.getList({
      resource: "event-kinds",
      pagination: { currentPage: 1, pageSize: 20 },
      filters: [{ field: "status", operator: "eq", value: "published" }],
    });
    const [url] = fetchStub.mock.calls[0] as unknown as [string];
    expect(url).toBe(
      "/v1/admin/event-kinds?page=1&pageSize=20&status=published",
    );
  });

  it("012 EARS-25: a kind create posts JSON with no file part", async () => {
    const fetchStub = stub({ id: "kind-1" }, 201);
    await dataProvider.create({
      resource: "event-kinds",
      variables: { title: "Лекция", allowedFormats: ["online"] },
    });
    const [url, init] = fetchStub.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/v1/admin/event-kinds");
    expect((init.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      title: "Лекция",
      allowedFormats: ["online"],
    });
  });

  it("012 EARS-25: a kind edit PATCHes with If-Match and keeps the version out of the body", async () => {
    const fetchStub = stub({ id: "kind-1" });
    await dataProvider.update({
      resource: "event-kinds",
      id: "kind-1",
      variables: { allowedFormats: ["online", "hybrid"], version: 3 },
    });
    const [url, init] = fetchStub.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/v1/admin/event-kinds/kind-1");
    expect((init.headers as Record<string, string>)["if-match"]).toBe('W/"3"');
    expect(JSON.parse(init.body as string)).toEqual({
      allowedFormats: ["online", "hybrid"],
    });
  });

  it("012 EARS-25: a refused narrowing surfaces its errorCode and field errors", async () => {
    stub(
      {
        errorCode: "RELATIONSHIP_CONFLICT",
        errors: [
          { path: "allowedFormats", message: "summary" },
          { path: "allowedFormats.events.evt-1", message: "Конгресс 2026" },
        ],
      },
      409,
    );
    const error = (await dataProvider
      .update({
        resource: "event-kinds",
        id: "kind-1",
        variables: { allowedFormats: ["online"], version: 3 },
      })
      .catch((e: unknown) => e)) as {
      errorCode?: string;
      fieldErrors?: { path: string; message: string }[];
    };
    expect(error.errorCode).toBe("RELATIONSHIP_CONFLICT");
    expect(error.fieldErrors).toContainEqual({
      path: "allowedFormats.events.evt-1",
      message: "Конгресс 2026",
    });
  });
});

describe("dataProvider — the material cover (048 EARS-1, #3512)", () => {
  function stub(body: unknown, status = 200) {
    const fetchStub = vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
    );
    globalThis.fetch = fetchStub as unknown as typeof fetch;
    return fetchStub;
  }
  const doc = { type: "doc", content: [{ type: "paragraph" }] };

  it("048 EARS-1: a create with a cover posts multipart — the JSON payload part plus one `cover` file", async () => {
    const fetchStub = stub({ id: "m-1" }, 201);
    const cover = new File([new Uint8Array([1, 2, 3])], "c.png", {
      type: "image/png",
    });
    await dataProvider.create({
      resource: "materials",
      variables: { kind: "news", title: "Новость", body: doc, cover },
    });
    const [url, init] = fetchStub.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/v1/admin/materials");
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(JSON.parse(form.get("payload") as string)).toEqual({
      kind: "news",
      title: "Новость",
      body: doc,
    });
    expect((form.get("cover") as File).name).toBe("c.png");
    // The browser sets the multipart content-type WITH its boundary.
    expect(
      (init.headers as Record<string, string>)["content-type"],
    ).toBeUndefined();
  });

  it("048 EARS-1: a create without a cover and a cover clear stay JSON", async () => {
    const fetchStub = stub({ id: "m-1" });
    await dataProvider.update({
      resource: "materials",
      id: "m-1",
      variables: { mediaAction: "clear", cover: null, version: 2 },
    });
    const [, init] = fetchStub.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );
    expect((init.headers as Record<string, string>)["if-match"]).toBe('W/"2"');
    expect(JSON.parse(init.body as string)).toEqual({ mediaAction: "clear" });
  });
});

describe("dataProvider.custom — a write answered with no body", () => {
  it("047 EARS-7: a 204 No Content (the revocation) resolves with no data instead of failing to read a body", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 204 }),
    ) as unknown as typeof fetch;

    await expect(
      dataProvider.custom!({
        url: "/v1/admin/staff-access/revocations",
        method: "post",
        payload: { userId: "sub-2", role: "platform_admin" },
      }),
    ).resolves.toEqual({ data: null });
  });
});

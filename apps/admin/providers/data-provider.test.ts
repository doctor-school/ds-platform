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

    return dataProvider
      .custom!({ url: "/v1/admin/events/evt-1/publish", method: "post" })
      .then(
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

  it("EARS-7: `errorCode` wins when a body carries both", async () => {
    const error = (await refusalFrom(
      { errorCode: "IDEMPOTENCY_KEY_REUSED", code: "SOMETHING_ELSE" },
      409,
    )) as { errorCode?: string };

    expect(error.errorCode).toBe("IDEMPOTENCY_KEY_REUSED");
  });
});

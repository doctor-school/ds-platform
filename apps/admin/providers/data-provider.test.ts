import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEligibleExpertUsers } from "./data-provider";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("fetchEligibleExpertUsers", () => {
  it("EARS-19: requests one bounded server-search page instead of exhausting the roster", async () => {
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

    const result = await fetchEligibleExpertUsers({
      currentExpertId: "00000000-0000-4000-8000-000000000002",
      q: "  Петров  ",
      page: 1,
      pageSize: 25,
    });

    expect(result.total).toBe(101);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub).toHaveBeenCalledWith(
      "/v1/admin/experts/eligible-users?page=1&pageSize=25&q=%D0%9F%D0%B5%D1%82%D1%80%D0%BE%D0%B2&currentExpertId=00000000-0000-4000-8000-000000000002",
      { credentials: "include", headers: { accept: "application/json" } },
    );
  });
});

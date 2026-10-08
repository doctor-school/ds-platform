import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchMonthBroadcasts,
  fetchMonthlyCounts,
} from "./public-events";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// 004 EARS-15 / EARS-16 — the month reads (wave-2 entry gate §2.1 row 14).
describe("004 EARS-15/16 month reads", () => {
  it("EARS-15: the month read passes the МСК month and is no-store", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse([]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchMonthBroadcasts("2026-07")).resolves.toEqual([]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/v1\/public\/events\?month=2026-07$/);
    expect(init?.cache).toBe("no-store");
  });

  it("EARS-16: the counts read passes the year and a failed read throws", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse([]),
    );
    vi.stubGlobal("fetch", fetchMock);
    await fetchMonthlyCounts("2026");
    expect(fetchMock.mock.calls[0]![0]).toMatch(
      /\/v1\/public\/events\/month-counts\?year=2026$/,
    );

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 500)));
    await expect(fetchMonthlyCounts("2026")).rejects.toThrow(
      /monthly counts fetch failed \(500\)/,
    );
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchPublicEventPage } from "./public-events";

// 004 EARS-1 — the public event-page read; wave-3 gate §4.4: it sits at the
// host's `contentSet.pagePath` (rows 1, 4).
function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const ACADEMY_READ = { pagePath: "/v1/public/events" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("004 EARS-1 fetchPublicEventPage — the public projection read", () => {
  it("EARS-1: the Academy read addresses `/v1/public/events/:slug`, cookie-free and no-store", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ slug: "cardio-2026" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchPublicEventPage(
        "cardio-2026",
        ACADEMY_READ,
        // The Academy declares no relay cookie: a session cookie never rides.
        new Headers({ cookie: "__Host-ds_session=abc" }),
      ),
    ).resolves.toEqual({ slug: "cardio-2026" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/v1\/public\/events\/cardio-2026$/);
    expect(init?.headers).toEqual({ accept: "application/json" });
    expect(init?.cache).toBe("no-store");
  });

  it("EARS-1: a host-config pagePath addresses `${pagePath}/:slug`", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ slug: "cardio-2026" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchPublicEventPage(
      "cardio-2026",
      { pagePath: "/v1/storefront/doctor/events" },
      new Headers(),
    );
    expect(fetchMock.mock.calls[0]![0]).toMatch(
      /\/v1\/storefront\/doctor\/events\/cardio-2026$/,
    );
  });

  it("EARS-1: a 404 yields null; any other failure throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, 404)),
    );
    await expect(
      fetchPublicEventPage("draft", ACADEMY_READ, new Headers()),
    ).resolves.toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, 503)),
    );
    await expect(
      fetchPublicEventPage("x", ACADEMY_READ, new Headers()),
    ).rejects.toThrow(/public event page fetch failed \(503\)/);
  });
});

describe("020 EARS-19 the event-page read gives up after 10 seconds", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("EARS-19: a read the api never answers rejects at 10 s, so the page renders its error state", async () => {
    vi.useFakeTimers();
    // A hung api: the response never arrives; only an abort ends the call.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(init.signal?.reason ?? new Error("aborted")),
            );
          }),
      ),
    );

    let settled: "pending" | "rejected" | "resolved" = "pending";
    const read = fetchPublicEventPage("x", ACADEMY_READ, new Headers()).then(
      () => (settled = "resolved"),
      () => (settled = "rejected"),
    );

    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    await read;
    expect(settled).toBe("rejected");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  InvalidEventCursorError,
  fetchEventListing,
  fetchEventListingWithCursorFallback,
} from "./public-events";

/**
 * #1640 — the public `/webinars` listing must survive a malformed `?cursor=`.
 *
 * The cursor is opaque (`@ds/schemas` bounds its length only), so the portal
 * cannot judge it at the URL boundary the way it judges `?month=`: only the api
 * can decode it, and it correctly answers `400` on a cursor it cannot decode.
 * Before this fix that `400` became a thrown `Error` inside a server component
 * and surfaced as an unstyled Next 500 on a public marketing page — a shared or
 * hand-edited link was enough to break the page.
 *
 * The contract these tests pin: a rejected cursor is not an error, it is
 * "start from the first page"; every OTHER non-ok status stays a real error.
 */
function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const PAGE = {
  data: [],
  counts: { upcoming: 0, past: 0 },
  pagination: { nextCursor: null, hasMore: false },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchEventListing", () => {
  it("#1640: a cursor the api rejects (400) raises InvalidEventCursorError, not a generic failure", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 400));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchEventListing({ timeframe: "upcoming", cursor: "not-a-cursor" }),
    ).rejects.toBeInstanceOf(InvalidEventCursorError);
  });

  it("#1640: a 400 with no cursor in play stays a generic failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, 400)),
    );

    const failure = fetchEventListing({ timeframe: "upcoming" });
    await expect(failure).rejects.toThrow(/event listing fetch failed \(400\)/);
    await expect(failure).rejects.not.toBeInstanceOf(InvalidEventCursorError);
  });

  it("#1640: the published CURSOR_INVALID errorCode is what classifies the 400", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ errorCode: "CURSOR_INVALID" }, 400)),
    );

    await expect(
      fetchEventListing({ timeframe: "upcoming", cursor: "not-a-cursor" }),
    ).rejects.toBeInstanceOf(InvalidEventCursorError);
  });

  it("#1640: a 400 raised by another param (VALIDATION_FAILED) is NOT swallowed as a cursor rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ errorCode: "VALIDATION_FAILED" }, 400)),
    );

    const failure = fetchEventListing({
      timeframe: "upcoming",
      cursor: "a-perfectly-good-cursor",
      limit: -1,
    });
    await expect(failure).rejects.toThrow(/event listing fetch failed \(400\)/);
    await expect(failure).rejects.not.toBeInstanceOf(InvalidEventCursorError);
  });
});

describe("fetchEventListingWithCursorFallback", () => {
  it("#1640: a malformed cursor falls back to the first page instead of throwing", async () => {
    const fetchMock = vi
      .fn<(url: string) => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse({}, 400))
      .mockResolvedValueOnce(jsonResponse(PAGE));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchEventListingWithCursorFallback({
      timeframe: "upcoming",
      cursor: "%%%broken%%%",
    });

    expect(result.cursorRejected).toBe(true);
    expect(result.listing).toEqual(PAGE);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("cursor=");
    expect(String(fetchMock.mock.calls[1]?.[0])).not.toContain("cursor=");
  });

  it("#1640: a cursor the api accepts is used as-is, with no retry", async () => {
    const fetchMock = vi
      .fn<(url: string) => Promise<Response>>()
      .mockResolvedValue(jsonResponse(PAGE));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchEventListingWithCursorFallback({
      timeframe: "past",
      cursor: "valid-cursor",
    });

    expect(result.cursorRejected).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("#1640: a real upstream failure still propagates — the fallback is cursor-only", async () => {
    const fetchMock = vi
      .fn<(url: string) => Promise<Response>>()
      .mockResolvedValue(jsonResponse({}, 503));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchEventListingWithCursorFallback({
        timeframe: "upcoming",
        cursor: "valid-cursor",
      }),
    ).rejects.toThrow(/event listing fetch failed \(503\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

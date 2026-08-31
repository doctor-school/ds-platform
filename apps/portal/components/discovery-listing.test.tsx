import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * #1640 host projection — what the visitor's URL looks like after a rejected
 * `?cursor=`.
 *
 * `/webinars` pagination is THREE query params, not two: `cursor`, `page` and
 * `cursorTrail` (the back-stack of previously visited cursors, written by
 * `event-list-router.tsx` alongside every "next"). The repo has one canonical
 * reset and it clears all three together (`lib/webinars-url.ts` →
 * `resetFeedPage`, and the tab switch in `event-list-router.tsx`).
 *
 * The server component can reset only what it passes down; `cursorTrail` lives
 * in the URL the client router reads back through `useSearchParams()`. So a
 * partial reset renders page 1 while the router still holds the stale trail —
 * "next" then "previous" pops a foreign cursor and shows page-3 content under a
 * page-1 label. The fix therefore redirects to the canonical stripped URL,
 * which clears all three atomically and leaves the visitor with a clean,
 * shareable link (no reload re-issues the doomed upstream request either).
 */

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Map<string, string>(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

const fetchEventListingWithCursorFallback = vi.fn();
vi.mock("@/lib/public-events", () => ({
  fetchEventListingWithCursorFallback: (input: unknown) =>
    fetchEventListingWithCursorFallback(input),
}));

vi.mock("@/lib/my-events", () => ({
  fetchMyEvents: async () => ({ authenticated: false }),
}));

import DiscoveryListing from "./discovery-listing";

const EMPTY_LISTING = {
  data: [],
  counts: { upcoming: 0, past: 0 },
  pagination: { nextCursor: null, hasMore: false },
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("DiscoveryListing cursor rejection", () => {
  it("#1640: a rejected cursor redirects to the canonical URL, clearing cursor, cursorTrail and page", async () => {
    fetchEventListingWithCursorFallback.mockResolvedValue({
      listing: EMPTY_LISTING,
      cursorRejected: true,
    });

    await expect(
      DiscoveryListing({
        monthViewHref: "/webinars?view=month",
        timeframe: "past",
        cursor: "GARBAGE",
        page: 3,
        queryParams: {
          tab: "past",
          cursor: "GARBAGE",
          cursorTrail: "c1,c2",
          page: "3",
        },
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/webinars?tab=past");

    expect(redirect).toHaveBeenCalledWith("/webinars?tab=past");
  });

  it("#1640: an accepted cursor renders in place — no redirect", async () => {
    fetchEventListingWithCursorFallback.mockResolvedValue({
      listing: EMPTY_LISTING,
      cursorRejected: false,
    });

    await DiscoveryListing({
      monthViewHref: "/webinars?view=month",
      timeframe: "past",
      cursor: "c2",
      page: 2,
      queryParams: {
        tab: "past",
        cursor: "c2",
        cursorTrail: "c1",
        page: "2",
      },
    });

    expect(redirect).not.toHaveBeenCalled();
  });
});

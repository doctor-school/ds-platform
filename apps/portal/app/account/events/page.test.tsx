import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 014 EARS-6 / #1987 — the «Мои события» door carries the visitor's OWN page.
 *
 * `/account/events` is an authenticated surface: a guest (no or expired session)
 * is sent to the Academy's login route. The live C6 walk (PR #2205) found that
 * hop dropping the return target entirely, so a guest who opened their own
 * events, signed in, and was dropped on the discovery listing — the one page
 * they had not asked for.
 *
 * The carry is the shared one: `withReturnTarget` re-appends only a
 * guard-clean, canonical same-origin path, and the account FAMILY is a legal
 * landing shape in `@ds/auth-flow` (`parseAccountReturnTarget`), so the target
 * survives the whole round-trip on both storefronts. Only the two Next
 * request-scoped primitives and the authed read are mocked — the route and the
 * carry are the real ones.
 */

const redirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirect(to),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

const fetchMyEvents = vi.fn();
vi.mock("../../../lib/my-events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/my-events")>()),
  fetchMyEvents: (...args: unknown[]) => fetchMyEvents(...args),
}));

import MyEventsPage from "./page";

beforeEach(() => {
  redirect.mockClear();
  fetchMyEvents.mockReset().mockResolvedValue({ authenticated: false });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("014 EARS-6: /account/events sends a guest to the door WITH its return target", () => {
  it("014 EARS-6.7: a guest is redirected to /login carrying this page as the returnTo", async () => {
    await expect(
      MyEventsPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_REDIRECT:/login?returnTo=%2Faccount%2Fevents");
    expect(redirect).toHaveBeenCalledWith(
      "/login?returnTo=%2Faccount%2Fevents",
    );
  });

  it("014 EARS-6.7: the carried target is the page's own route, never the visitor's query", async () => {
    await expect(
      MyEventsPage({
        searchParams: Promise.resolve({
          tab: "recordings",
          returnTo: "//evil.example",
        }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/login?returnTo=%2Faccount%2Fevents");
  });
});

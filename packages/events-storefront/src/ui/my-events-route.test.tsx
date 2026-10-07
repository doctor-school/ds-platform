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
 * carry are the real ones. Moved from the Academy route file in wave-2 PR 2.3
 * (gate row 24): the package route owns the guest decision on both hosts, the
 * door and the page path read from the host config.
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

const fetchMyEvents = vi.fn();
vi.mock("../server/my-events", () => ({
  fetchMyEvents: (...args: unknown[]) => fetchMyEvents(...args),
}));

import type { EventsStorefrontHostConfig } from "../host-config";
import { MyEventsRoute } from "./my-events-route";

const CONFIG = {
  headerCopy: { title: "t", subline: "s" },
  contentSet: { myEventsPath: "/v1/me/events" },
  routes: {
    listing: "/webinars",
    eventPage: "/webinars",
    login: "/login",
    accountEvents: "/account/events",
  },
} satisfies EventsStorefrontHostConfig;

const MyEventsPage = ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => MyEventsRoute({ config: CONFIG, searchParams });

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

  it("014 EARS-6.7: the read goes to the host's configured endpoint for the requested tab", async () => {
    await expect(
      MyEventsRoute({
        config: {
          ...CONFIG,
          contentSet: { myEventsPath: "/v1/storefront/doctor/me/events" },
        },
        searchParams: Promise.resolve({ tab: "recordings" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(fetchMyEvents).toHaveBeenCalledWith(
      "/v1/storefront/doctor/me/events",
      expect.anything(),
      "recordings",
    );
  });
});

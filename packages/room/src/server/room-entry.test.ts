import { describe, expect, it } from "vitest";

import { resolveRoomEntry, type RoomEntryRoutes } from "./room-entry";
import type { RoomAccess } from "./room-config";
import type { RoomConfig } from "@ds/schemas";

/**
 * 006 EARS-6 — the denied-access routing table, now the SHARED unit's.
 *
 * Until #1722 this branch table lived inside the Academy page's `switch`, and its
 * only verification was `apps/portal/e2e/room-access-branches.spec.ts` — a
 * dev-stand-gated spec that is inert in CI. Lifting it into a pure function is
 * what makes the four refusals assertable, and asserting it over BOTH host route
 * tables is what proves the doctor storefront never routes a doctor to an Academy
 * login (D10 / ADR-0015 §4 REQ-24).
 */

const SLUG = "kardio-2026";

/** The Academy's table — byte-identical targets to the pre-#1722 page switch. */
const ACADEMY: RoomEntryRoutes = {
  auth: `/login?returnTo=${encodeURIComponent(`/webinars/${SLUG}/room`)}`,
  register: `/webinars/${SLUG}?from=room`,
  notLive: `/webinars/${SLUG}`,
};

/** The doctor storefront's table — D10: the auth branch is the event page. */
const DOCTOR: RoomEntryRoutes = {
  auth: `/events/${SLUG}`,
  register: `/events/${SLUG}?from=room`,
  notLive: `/events/${SLUG}`,
};

const grantedConfig = {
  slug: SLUG,
  presenceCount: 3,
} as unknown as RoomConfig;

const granted: RoomAccess = { kind: "granted", config: grantedConfig };

describe("006 EARS-6: room entry resolution", () => {
  it("006 EARS-6.1: an unauthenticated caller on the academy host is routed to /login with the room returnTo", () => {
    expect(resolveRoomEntry({ kind: "auth" }, ACADEMY)).toEqual({
      kind: "redirect",
      href: `/login?returnTo=${encodeURIComponent(`/webinars/${SLUG}/room`)}`,
    });
  });

  it("006 EARS-6.1: an unauthenticated caller on the doctor host is routed to the doctor event page, never to an academy login", () => {
    const outcome = resolveRoomEntry({ kind: "auth" }, DOCTOR);
    expect(outcome).toEqual({ kind: "redirect", href: `/events/${SLUG}` });
    // The whole point of D10: no cross-origin bounce into the Academy's auth flow.
    expect(JSON.stringify(outcome)).not.toContain("login");
    expect(JSON.stringify(outcome)).not.toContain("academy");
  });

  it("006 EARS-6.2: an unregistered caller is routed to the academy event page with from=room", () => {
    expect(resolveRoomEntry({ kind: "register" }, ACADEMY)).toEqual({
      kind: "redirect",
      href: `/webinars/${SLUG}?from=room`,
    });
  });

  it("006 EARS-6.2: an unregistered caller is routed to the doctor event page with from=room", () => {
    expect(resolveRoomEntry({ kind: "register" }, DOCTOR)).toEqual({
      kind: "redirect",
      href: `/events/${SLUG}?from=room`,
    });
  });

  it("006 EARS-6.3: a not-live event routes to the academy event page", () => {
    expect(resolveRoomEntry({ kind: "not-live" }, ACADEMY)).toEqual({
      kind: "redirect",
      href: `/webinars/${SLUG}`,
    });
  });

  it("006 EARS-6.3: a not-live event routes to the doctor event page", () => {
    expect(resolveRoomEntry({ kind: "not-live" }, DOCTOR)).toEqual({
      kind: "redirect",
      href: `/events/${SLUG}`,
    });
  });

  it("006 EARS-6.4: an unknown event is a 404 on the academy host", () => {
    expect(resolveRoomEntry({ kind: "not-found" }, ACADEMY)).toEqual({
      kind: "not-found",
    });
  });

  it("006 EARS-6.4: an unknown event is a 404 on the doctor host", () => {
    expect(resolveRoomEntry({ kind: "not-found" }, DOCTOR)).toEqual({
      kind: "not-found",
    });
  });

  it("006 EARS-6: a granted caller renders the room, carrying the grant through", () => {
    expect(resolveRoomEntry(granted, ACADEMY)).toEqual({
      kind: "render",
      config: grantedConfig,
    });
    expect(resolveRoomEntry(granted, DOCTOR)).toEqual({
      kind: "render",
      config: grantedConfig,
    });
  });
});

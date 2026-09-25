import { describe, expect, it } from "vitest";
import type { AdminSessionResponse } from "@ds/schemas";
import {
  ADMIN_SECTION_NAV,
  adminAccess,
  adminNavItems,
  canAccessPath,
  canAccessResource,
  landingRedirect,
} from "./admin-access";

/**
 * 044 EARS-20 / EARS-38 — the admin navigation and route gate are a PROJECTION of
 * the `GET /v1/admin/auth/session` read (`roles` + `eventGrants`): they decide
 * what is drawn, never what is permitted — the server refusal (EARS-19/38) is
 * the authority.
 */
const EVENT_A = "0b5f7c1e-4c1a-4e7e-9a55-0a4f2d9b1a0a";
const EVENT_B = "1c6e8d2f-5d2b-4f8f-8b66-1b5e3eac2b0b";

const registrarBoundToA: AdminSessionResponse = {
  roles: ["event-registrar"],
  eventGrants: [
    { role: "event-registrar", eventId: EVENT_A, eventSlug: "congress-a" },
  ],
};
const registrarUnbound: AdminSessionResponse = {
  roles: ["event-registrar"],
  eventGrants: [],
};
const platformAdmin: AdminSessionResponse = {
  roles: ["platform_admin"],
  eventGrants: [],
};

describe("044 EARS-20 admin access projection", () => {
  it("044 EARS-20.1: a registrar bound to an event gets only that event's roster", () => {
    const access = adminAccess(registrarBoundToA);

    expect(adminNavItems(access)).toEqual([
      {
        href: `/events/${EVENT_A}/roster`,
        testId: "nav-roster",
        labelKey: "congressRoster.entryLink",
      },
    ]);
    expect(canAccessPath(access, `/events/${EVENT_A}/roster`)).toBe(true);
    expect(canAccessPath(access, `/events/congress-a/roster`)).toBe(true);
    expect(canAccessPath(access, `/events/${EVENT_B}/roster`)).toBe(false);
    expect(canAccessPath(access, "/events")).toBe(false);
    expect(canAccessPath(access, `/events/${EVENT_A}`)).toBe(false);
    expect(canAccessPath(access, "/projects")).toBe(false);
    expect(canAccessResource(access, "congress-roster", { id: EVENT_A })).toBe(
      true,
    );
    expect(canAccessResource(access, "congress-roster", { id: EVENT_B })).toBe(
      false,
    );
    expect(canAccessResource(access, "events", { id: EVENT_A })).toBe(false);
  });

  it("044 EARS-20.2: a registrar without a binding row gets nothing", () => {
    const access = adminAccess(registrarUnbound);

    expect(adminNavItems(access)).toEqual([]);
    expect(canAccessPath(access, `/events/${EVENT_A}/roster`)).toBe(false);
    expect(canAccessPath(access, "/events")).toBe(false);
    expect(canAccessResource(access, "congress-roster", { id: EVENT_A })).toBe(
      false,
    );
  });

  it("044 EARS-20.3: platform_admin keeps the full section set, unbound by grants", () => {
    const access = adminAccess(platformAdmin);

    expect(adminNavItems(access)).toEqual(ADMIN_SECTION_NAV);
    expect(ADMIN_SECTION_NAV.map((item) => item.href)).toEqual([
      "/events",
      "/projects",
      "/experts",
      "/partners",
      "/directions",
      "/direction-specialties",
      "/direction-adjacency",
      "/specialties",
    ]);
    expect(canAccessPath(access, "/events")).toBe(true);
    expect(canAccessPath(access, `/events/${EVENT_B}/roster`)).toBe(true);
    expect(canAccessResource(access, "events")).toBe(true);
    // A platform_admin who ALSO holds a registrar grant is still unlimited.
    const both = adminAccess({
      roles: ["platform_admin", "event-registrar"],
      eventGrants: registrarBoundToA.eventGrants,
    });
    expect(adminNavItems(both)).toEqual(ADMIN_SECTION_NAV);
    expect(canAccessPath(both, "/projects")).toBe(true);
  });

  it("044 EARS-20.4: an unreadable session fails closed — nothing drawn, nothing reachable", () => {
    const access = adminAccess(null);

    expect(adminNavItems(access)).toEqual([]);
    expect(canAccessPath(access, "/events")).toBe(false);
    expect(canAccessResource(access, "events")).toBe(false);
  });

  it("044 EARS-20.6: a single-link principal lands on that link; direct refused routes keep the refusal", () => {
    const access = adminAccess(registrarBoundToA);
    const roster = `/events/${EVENT_A}/roster`;

    // The sign-in landings resolve to the one roster.
    expect(landingRedirect(access, "/events")).toBe(roster);
    expect(landingRedirect(access, "/")).toBe(roster);
    // Any other refused route is a direct navigation: the refusal stays.
    expect(landingRedirect(access, "/projects")).toBeNull();
    expect(landingRedirect(access, `/events/${EVENT_B}/roster`)).toBeNull();
    // The roster itself is open — nothing to redirect.
    expect(landingRedirect(access, roster)).toBeNull();
    // Zero links (unbound, unreadable) or the full set: never redirected.
    expect(
      landingRedirect(adminAccess(registrarUnbound), "/events"),
    ).toBeNull();
    expect(landingRedirect(adminAccess(null), "/events")).toBeNull();
    expect(landingRedirect(adminAccess(platformAdmin), "/events")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import {
  buildRoomRouteTable,
  type RoomRouteTableHost,
} from "./room-route-table";

/**
 * 006 EARS-6 / EARS-11 — the room route table, built once over host values
 * (wave-4 gate row 22).
 *
 * The invariant is cross-HOST: entry resolution routes through whichever table
 * its host's values produce, so a guest goes to THAT host's login carrying a
 * same-origin return to THAT host's room, and the two signed-in refusals land on
 * that host's event page. The Academy values below are the ones
 * `apps/portal/lib/events-storefront.host-config.ts` states; the table they
 * produce is the one the Academy room route shipped before #2073 PR 4.3.
 */

const ACADEMY: RoomRouteTableHost = {
  room: "/webinars/:slug/room",
  eventPage: "/webinars/:slug",
  brandHome: "/webinars",
  login: "/login",
};

const DOCTOR: RoomRouteTableHost = {
  room: "/events/:slug/room",
  eventPage: "/events/:slug",
  brandHome: "/",
  login: "/login",
};

describe("006 room route table over host values", () => {
  it("006 EARS-6: a guest is sent to this host's own login carrying a same-origin return to the room", () => {
    const routes = buildRoomRouteTable("cardio-live", ACADEMY);

    expect(routes.entry.auth).toBe(
      "/login?returnTo=%2Fwebinars%2Fcardio-live%2Froom",
    );
    for (const href of Object.values(routes.entry)) {
      expect(href.startsWith("/")).toBe(true);
      expect(href.startsWith("//")).toBe(false);
      expect(href).not.toMatch(/\/events\//);
    }
    // The other host's values never leak into this table, and vice versa.
    expect(buildRoomRouteTable("cardio-live", DOCTOR).entry.auth).toBe(
      "/login?returnTo=%2Fevents%2Fcardio-live%2Froom",
    );
  });

  it("006 EARS-6: a signed-in doctor without a registration gets the event page with ?from=room; a registered doctor before the live window gets the bare event page", () => {
    const routes = buildRoomRouteTable("cardio-live", ACADEMY);

    expect(routes.entry.register).toBe("/webinars/cardio-live?from=room");
    expect(routes.entry.notLive).toBe("/webinars/cardio-live");
  });

  it("006 EARS-11: the in-room links are the host's brand home and the event page", () => {
    expect(buildRoomRouteTable("cardio-live", ACADEMY).room).toEqual({
      brandHome: "/webinars",
      eventPage: "/webinars/cardio-live",
    });
    expect(buildRoomRouteTable("cardio-live", DOCTOR).room).toEqual({
      brandHome: "/",
      eventPage: "/events/cardio-live",
    });
  });

  it("006 EARS-11: the slug is url-encoded into every target", () => {
    const slug = "кардио/эфир";
    const routes = buildRoomRouteTable(slug, ACADEMY);
    const eventPage = `/webinars/${encodeURIComponent(slug)}`;

    expect(routes.entry.auth).toBe(
      `/login?returnTo=${encodeURIComponent(`${eventPage}/room`)}`,
    );
    expect(routes.entry.register).toBe(`${eventPage}?from=room`);
    expect(routes.entry.notLive).toBe(eventPage);
    expect(routes.room.eventPage).toBe(eventPage);
    expect(routes.room.brandHome).toBe("/webinars");
  });

  it("006 EARS-6: an event-page template without exactly one :slug is refused", () => {
    expect(() =>
      buildRoomRouteTable("x", { ...ACADEMY, eventPage: "/webinars" }),
    ).toThrow(TypeError);
  });
});

import { describe, expect, it } from "vitest";

import {
  ACADEMY_EVENT_PAGE,
  ACADEMY_ROOM_PAGE,
} from "./events-storefront.host-config";
import { ACADEMY_ROOM_ROUTES } from "./room-config";

// Wave-3 gate §4.4 — the Academy's event-page host config is data only: the
// public read path, the routes `academy.doctor.school` serves and the one copy
// word the page varies by host. No relay cookie (the Academy read is public).
describe("020 EARS-18 ACADEMY_EVENT_PAGE — the Academy's event-page host values", () => {
  it("EARS-18: reads the public event page and states the Academy routes and breadcrumb", () => {
    expect(ACADEMY_EVENT_PAGE).toEqual({
      contentSet: { pagePath: "/v1/public/events" },
      routes: {
        listing: "/webinars",
        eventPage: "/webinars",
        login: "/login",
        register: "/register",
      },
      copy: { breadcrumb: "Эфиры" },
    });
  });

  it("EARS-18: carries no function-valued field (closed adapter list §4.5 is empty)", () => {
    const values = JSON.stringify(ACADEMY_EVENT_PAGE, (_k, v: unknown) =>
      typeof v === "function" ? "<fn>" : v,
    );
    expect(values).not.toContain("<fn>");
  });
});

// Wave-4 gate D9 / rows 22, 24 — the Academy's live-room host config: the
// values the room route table and the brand-home label are built from. The
// table they produce is pinned in `app/webinars/[slug]/room/page.test.tsx`.
describe("006 EARS-6 ACADEMY_ROOM_PAGE — the Academy's live-room host values", () => {
  it("EARS-6: states the Academy room, event-page, brand-home and login routes, the brand-home label and the public event read", () => {
    expect(ACADEMY_ROOM_PAGE).toEqual({
      routes: {
        room: "/webinars/:slug/room",
        eventPage: "/webinars/:slug",
        brandHome: "/webinars",
        login: "/login",
      },
      copy: { brandHome: "На страницу эфиров" },
      eventRead: { pagePath: "/v1/public/events" },
    });
  });

  it("EARS-6: the room template is the one the room-return codec reads", () => {
    expect(ACADEMY_ROOM_PAGE.routes.room).toBe(ACADEMY_ROOM_ROUTES.room);
  });

  it("EARS-6: carries no function-valued field (the closed adapter list is empty)", () => {
    const values = JSON.stringify(ACADEMY_ROOM_PAGE, (_k, v: unknown) =>
      typeof v === "function" ? "<fn>" : v,
    );
    expect(values).not.toContain("<fn>");
  });
});

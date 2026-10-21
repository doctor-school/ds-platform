import { describe, expect, it } from "vitest";

import {
  DOCTOR_EVENT_PAGE,
  DOCTOR_ROOM_PAGE,
} from "./events-storefront.host-config";
import { DOCTOR_ROOM_RETURN_ROUTES } from "./room-config";

// Wave-4 gate D9 / rows 22, 24 — the doctor storefront's live-room host config:
// the values the room route table and the brand-home label are built from. The
// table they produce is pinned in `app/(room)/events/[slug]/room/page.test.tsx`.
describe("006 EARS-6 DOCTOR_ROOM_PAGE — the doctor storefront's live-room host values", () => {
  it("EARS-6: states the doctor room, event-page, brand-home and login routes, the brand-home label and the public event read", () => {
    expect(DOCTOR_ROOM_PAGE).toEqual({
      routes: {
        room: "/events/:slug/room",
        eventPage: "/events/:slug",
        brandHome: "/",
        login: "/login",
      },
      copy: { brandHome: "На главную" },
      eventRead: {
        pagePath: "/v1/storefront/doctor/events",
        relayCookie: "__Host-ds_specialty",
      },
    });
  });

  it("EARS-6: the room template is the one the room-return codec reads", () => {
    expect(DOCTOR_ROOM_PAGE.routes.room).toBe(DOCTOR_ROOM_RETURN_ROUTES.room);
  });

  it("EARS-2: the room's event context is the same read the doctor event page makes", () => {
    expect(DOCTOR_ROOM_PAGE.eventRead).toBe(DOCTOR_EVENT_PAGE.contentSet);
  });

  it("EARS-6: carries no function-valued field (the closed adapter list is empty)", () => {
    const values = JSON.stringify(DOCTOR_ROOM_PAGE, (_k, v: unknown) =>
      typeof v === "function" ? "<fn>" : v,
    );
    expect(values).not.toContain("<fn>");
  });
});

import { isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { buildRoomRouteTable } from "@ds/room/route-table";
import { RoomPage, type RoomPageProps } from "@ds/room-page/page";

import { DOCTOR_ROOM_PAGE } from "../../../../../lib/events-storefront.host-config";
import DoctorRoomPage, { dynamic } from "./page";

/**
 * 006 EARS-2 / EARS-6 — the doctor live room is a mount of `@ds/room-page`
 * (#2073, wave-4 PR 4.4).
 *
 * The route file hands the package page the doctor host config and its
 * `params`, and nothing else. This suite pins the mount and the route table the
 * doctor values produce — the same table the doctor room route shipped before
 * the move (the deleted `room-routes.test.ts`); the page's branches are asserted
 * in `packages/room-page/src/ui/room-page.test.tsx`.
 */

async function mount(): Promise<ReactElement<RoomPageProps>> {
  const params = Promise.resolve({ slug: "cardio-live" });
  const tree = await DoctorRoomPage({ params });
  if (!isValidElement<RoomPageProps>(tree)) {
    throw new Error("the room route renders no element");
  }
  return tree;
}

describe("#2073: /events/:slug/room is a mount of @ds/room-page with the doctor host config", () => {
  it("the route renders the package page with DOCTOR_ROOM_PAGE and its params, nothing else", async () => {
    const tree = await mount();
    expect(tree.type).toBe(RoomPage);
    expect(Object.keys(tree.props).sort()).toEqual(["config", "params"]);
    expect(tree.props.config).toBe(DOCTOR_ROOM_PAGE);
    await expect(tree.props.params).resolves.toEqual({ slug: "cardio-live" });
  });

  it("the room is rendered per request, never prerendered", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("006 EARS-6 / EARS-11: the doctor values produce the doctor route table — this host's own login, never an Academy one", () => {
    expect(buildRoomRouteTable("cardio-live", DOCTOR_ROOM_PAGE.routes)).toEqual(
      {
        entry: {
          auth: "/login?returnTo=%2Fevents%2Fcardio-live%2Froom",
          register: "/events/cardio-live?from=room",
          notLive: "/events/cardio-live",
        },
        room: {
          brandHome: "/",
          eventPage: "/events/cardio-live",
          accountEvents: "/account/events",
        },
      },
    );
  });

  it("006 EARS-11: the slug is url-encoded into every target", () => {
    const table = buildRoomRouteTable("a b/c", DOCTOR_ROOM_PAGE.routes);
    expect(table.entry.auth).toBe(
      `/login?returnTo=${encodeURIComponent("/events/a%20b%2Fc/room")}`,
    );
    expect(table.entry.register).toBe("/events/a%20b%2Fc?from=room");
    expect(table.room.eventPage).toBe("/events/a%20b%2Fc");
  });

  it("006 EARS-10: the brand-home label pairs with the doctor storefront home", () => {
    expect(DOCTOR_ROOM_PAGE.copy.brandHome).toBe("На главную");
  });
});

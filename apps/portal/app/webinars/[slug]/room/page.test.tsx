import { isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { buildRoomRouteTable } from "@ds/room/route-table";
import { RoomPage, type RoomPageProps } from "@ds/room-page/page";

import { ACADEMY_ROOM_PAGE } from "../../../../lib/events-storefront.host-config";
import WebinarRoomPage, { dynamic } from "./page";

/**
 * 006 EARS-2 / EARS-6 — the Academy live room is a mount of `@ds/room-page`
 * (#2073, wave-4 PR 4.3).
 *
 * The route file hands the package page the Academy host config and its
 * `params`, and nothing else. This suite pins the mount and the route table the
 * Academy values produce — the same table the Academy room route shipped before
 * the move; the page's branches are asserted in
 * `packages/room-page/src/ui/room-page.test.tsx`.
 */

async function mount(): Promise<ReactElement<RoomPageProps>> {
  const params = Promise.resolve({ slug: "cardio-live" });
  const tree = await WebinarRoomPage({ params });
  if (!isValidElement<RoomPageProps>(tree)) {
    throw new Error("the room route renders no element");
  }
  return tree;
}

describe("#2073: /webinars/:slug/room is a mount of @ds/room-page with the Academy host config", () => {
  it("the route renders the package page with ACADEMY_ROOM_PAGE and its params, nothing else", async () => {
    const tree = await mount();
    expect(tree.type).toBe(RoomPage);
    expect(Object.keys(tree.props).sort()).toEqual(["config", "params"]);
    expect(tree.props.config).toBe(ACADEMY_ROOM_PAGE);
    await expect(tree.props.params).resolves.toEqual({ slug: "cardio-live" });
  });

  it("the room is rendered per request, never prerendered", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("006 EARS-6 / EARS-11: the Academy values produce the Academy route table", () => {
    expect(
      buildRoomRouteTable("cardio-live", ACADEMY_ROOM_PAGE.routes),
    ).toEqual({
      entry: {
        auth: "/login?returnTo=%2Fwebinars%2Fcardio-live%2Froom",
        register: "/webinars/cardio-live?from=room",
        notLive: "/webinars/cardio-live",
      },
      room: {
        brandHome: "/webinars",
        eventPage: "/webinars/cardio-live",
      },
    });
  });

  it("006 EARS-10: the brand-home label pairs with the эфиры-list target", () => {
    expect(ACADEMY_ROOM_PAGE.copy.brandHome).toBe("На страницу эфиров");
  });
});

import type { PublicEventPageRead } from "@ds/events-storefront/server";
import type { RoomCopyHostValues } from "@ds/room/copy";
import type { RoomRouteTableHost } from "@ds/room/route-table";

/**
 * What a storefront states about itself so the ONE live-room route can serve it
 * (wave-4 entry gate D9, rows 22 / 24, ADR-0013 A1). DATA only — no callback,
 * resolver or predicate (plan §2; the closed adapter list is empty). Each host
 * declares it in a `lib/*.host-config.ts` module, checked with `satisfies`.
 */
export type RoomPageHostConfig = {
  /**
   * The route values the shared `buildRoomRouteTable` turns into the refusal
   * targets and the in-room links (row 22): the room path template (the value
   * the room-return codec interpolates), the event-page path template, the
   * brand-home target and the login route.
   */
  routes: RoomRouteTableHost;
  /** The brand-home label, paired with `routes.brandHome` (row 24). */
  copy: RoomCopyHostValues;
  /** The host's public event-page read — the room's event context strip (EARS-2). */
  eventRead: PublicEventPageRead;
};

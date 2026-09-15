import type { RoomEntryRoutes } from "@ds/room/server";
import { buildRoomReturnHref, type RoomRoutes } from "@ds/room";

import { ACADEMY_ROOM_ROUTES } from "../../../../lib/room-config";

/**
 * 006 EARS-6 / EARS-11 — the ACADEMY host's room route table (#1722 D8).
 *
 * The shared room unit owns no route: `resolveRoomEntry` takes the three refusal
 * targets and `RoomShell` takes the two navigation targets, so each storefront
 * declares its own front doors here and nothing about academy URLs leaks into
 * `packages/room`. The doctor storefront supplies its own table with the same
 * shape, which is why an unauthenticated doctor there never lands on an academy
 * login.
 *
 * The `auth` target keeps routing through the shared {@link buildRoomReturnHref}
 * — the guard-parsed same-origin return that `completeReturnTarget` re-admits to
 * the room (and fires no registration on the visitor's behalf). The codec is
 * shared; the path template it interpolates is this host's own value
 * (`lib/room-config.ts`).
 */
export interface PortalRoomRoutes {
  /** The three EARS-6 refusal targets consumed by `resolveRoomEntry`. */
  entry: RoomEntryRoutes;
  /** The two in-room navigation targets consumed by `RoomShell`. */
  room: RoomRoutes;
}

/** Build the academy route table for one event slug. */
export const PORTAL_ROOM_ROUTES = (slug: string): PortalRoomRoutes => {
  const eventPage = `/webinars/${encodeURIComponent(slug)}`;
  return {
    entry: {
      // The 003 login flow, carrying a same-origin `returnTo` back to THIS room
      // url so the gate RE-RUNS on return.
      auth: `/login?returnTo=${encodeURIComponent(buildRoomReturnHref(slug, ACADEMY_ROOM_ROUTES))}`,
      // The 004/005 event page with `?from=room`, which surfaces the
      // catalog-sourced access-branch guidance above the one-tap register door.
      register: `${eventPage}?from=room`,
      // The truthful 004 lifecycle state (upcoming / ended / hidden) — no room and
      // no register banner; the lifecycle render is the signal on its own.
      notLive: eventPage,
    },
    room: {
      brandHome: "/webinars",
      eventPage,
    },
  };
};

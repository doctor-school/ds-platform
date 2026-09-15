import type { RoomReturnRoutes } from "@ds/room/room-return";

/**
 * 006 EARS-6 — the ACADEMY storefront's HOST VALUES for the shared room unit
 * (`@ds/room`, wave-1 entry gate §2.1 rows 1–5, epic #2020 / #2027).
 *
 * Values only: the room-return codec lives once in the package and branches on
 * nothing (ADR-0013 A1). What `academy.doctor.school` states about itself is the
 * room's path template — `/webinars/<slug>/room`, the route
 * `apps/portal/app/webinars/[slug]/room/page.tsx` actually serves. A host that
 * serves no room states `room: undefined` and the codec then admits no room
 * return there at all.
 */
export const ACADEMY_ROOM_ROUTES = {
  room: "/webinars/:slug/room",
} as const satisfies RoomReturnRoutes;

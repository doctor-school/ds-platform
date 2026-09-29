import type { RoomReturnRoutes } from "@ds/room/room-return";

/**
 * 006 EARS-6 · 020 EARS-7 — the DOCTOR storefront's HOST VALUES for the shared room
 * unit (`@ds/room`), the counterpart of the Academy's `apps/portal/lib/room-config.ts`.
 *
 * Values only: the room-return codec lives once in the package (ADR-0013 A1). What
 * `doctor.school` states about itself is the room's path template —
 * `/events/<slug>/room`, the route `app/(room)/events/[slug]/room/page.tsx`
 * serves. The room table builds a guest's `returnTo` from it, and the auth-flow
 * host config states the same literal so the sign-in door lands the guest back in
 * the room (pinned in `auth-flow.host-config.test.ts`).
 */
export const DOCTOR_ROOM_RETURN_ROUTES = {
  room: "/events/:slug/room",
} as const satisfies RoomReturnRoutes;

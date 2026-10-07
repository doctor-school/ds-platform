import type { MyEventRoutes } from "@ds/events-storefront/server";

import { ACADEMY_ROOM_ROUTES } from "./room-config";

/**
 * The ACADEMY storefront's route values for the shared «Мои события» projection
 * (`@ds/events-storefront`, wave-2 entry gate §2.1 row 15). Values only: the
 * event page `apps/portal/app/webinars/[slug]/page.tsx` serves, and the same room
 * template this host hands `@ds/room`.
 */
export const ACADEMY_MY_EVENT_ROUTES = {
  eventPage: "/webinars/:slug",
  room: ACADEMY_ROOM_ROUTES.room,
} as const satisfies MyEventRoutes;

import { adaptPublicEventListing } from "@ds/events-storefront/adapters";
import type { EventsStorefrontHostConfig } from "@ds/events-storefront/host-config";
import type { EventPageHostConfig } from "@ds/event-page/host-config";
import type { RoomPageHostConfig } from "@ds/room-page/host-config";

/**
 * What the Academy states about itself so the shared events feed can serve it
 * (#2028, epic #2020 wave 2; gate §4.4). DATA only: its reads (the listing in
 * the horizon form, the experts' live read, «Мои события») and the one adapter
 * of §4.5 that maps the listing read, the routes `academy.doctor.school`
 * serves, its page head and its event noun.
 * Every rule and every other sentence lives in `@ds/events-storefront`.
 */
export const ACADEMY_EVENTS_STOREFRONT = {
  contentSet: {
    feedPath: "/v1/public/events",
    tenseParam: "timeframe",
    livePath: "/v1/public/events/live",
    myEventsPath: "/v1/me/events",
    monthPath: "/v1/public/events",
    countsPath: "/v1/public/events/month-counts",
    adapt: adaptPublicEventListing,
  },
  filterSet: "academy",
  headerCopy: {
    title: "Расписание эфиров",
    subline: { schoolNoun: { one: "школа", few: "школы", many: "школ" } },
  },
  copy: {
    eventNoun: { one: "эфир", few: "эфира", many: "эфиров" },
  },
  routes: {
    listing: "/webinars",
    eventPage: "/webinars",
    login: "/login",
    accountEvents: "/account/events",
  },
} satisfies EventsStorefrontHostConfig;

/**
 * What the Academy states about itself so the ONE event page
 * (`@ds/event-page`) can serve it at `/webinars/:slug` (#2072, epic #2020
 * wave 3; gate §4.4). DATA only: the public read path (no relay cookie — the
 * Academy read is public), the routes this host serves and its breadcrumb
 * word. Every rule and every other sentence lives in `@ds/event-page`.
 */
export const ACADEMY_EVENT_PAGE = {
  contentSet: {
    pagePath: "/v1/public/events",
  },
  routes: {
    listing: ACADEMY_EVENTS_STOREFRONT.routes.listing,
    eventPage: ACADEMY_EVENTS_STOREFRONT.routes.eventPage,
    login: ACADEMY_EVENTS_STOREFRONT.routes.login,
    register: "/register",
  },
  copy: {
    breadcrumb: "Эфиры",
  },
} satisfies EventPageHostConfig;

/**
 * What the Academy states about itself so the ONE live-room route
 * (`@ds/room-page`) can serve it at `/webinars/:slug/room` (#2073, wave-4 gate
 * D9, rows 22 / 24). DATA only: the room and event-page path templates, the
 * brand home (target and label — «На страницу эфиров» → the эфиры list), the
 * login route and the same public event read the event page makes. The room
 * template is the value `lib/room-config.ts` states for the room-return codec
 * (pinned equal by the test). Every rule lives in `@ds/room-page` / `@ds/room`.
 */
export const ACADEMY_ROOM_PAGE = {
  routes: {
    room: "/webinars/:slug/room",
    eventPage: "/webinars/:slug",
    brandHome: ACADEMY_EVENTS_STOREFRONT.routes.listing,
    login: ACADEMY_EVENTS_STOREFRONT.routes.login,
  },
  copy: {
    brandHome: "На страницу эфиров",
  },
  eventRead: ACADEMY_EVENT_PAGE.contentSet,
} satisfies RoomPageHostConfig;

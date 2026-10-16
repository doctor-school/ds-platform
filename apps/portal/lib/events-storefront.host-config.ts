import { adaptPublicEventListing } from "@ds/events-storefront/adapters";
import type { EventsStorefrontHostConfig } from "@ds/events-storefront/host-config";
import type { EventPageHostConfig } from "@ds/event-page/host-config";

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

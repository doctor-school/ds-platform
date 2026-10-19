import { adaptDoctorEventsFeed } from "@ds/events-storefront/adapters";
import type { EventsStorefrontHostConfig } from "@ds/events-storefront/host-config";
import type { EventPageHostConfig } from "@ds/event-page/host-config";

/**
 * What the doctor storefront states about itself so the shared events pages can
 * serve it (#1972, #2028, epic #2020 wave 2; gate §4.4). DATA only: its reads
 * (the specialty-targeted feed, the doctors' live read, «Мои события»), the one
 * cookie the feed read relays (017's remembered specialty, gate row 13 — the
 * name `apps/doctor/lib/specialty-choice.ts` writes), the one adapter of §4.5
 * that maps the feed read, the routes `doctor.school` serves and its page head.
 * Every rule and every sentence lives in `@ds/events-storefront`.
 */
export const DOCTOR_EVENTS_STOREFRONT = {
  contentSet: {
    feedPath: "/v1/storefront/doctor/events",
    tenseParam: "tense",
    relayCookie: "__Host-ds_specialty",
    livePath: "/v1/storefront/doctor/events/live",
    myEventsPath: "/v1/storefront/doctor/me/events",
    monthPath: "/v1/storefront/doctor/events/month",
    countsPath: "/v1/storefront/doctor/events/month-counts",
    adapt: adaptDoctorEventsFeed,
  },
  filterSet: "doctor",
  headerCopy: {
    title: "События",
    // 019 LD-9 (#2871): the line follows the applied specialty scope.
    subline: {
      byScope: {
        mineAndAdjacent: "События по вашей специальности и смежным",
        all: "События по всем специальностям",
        picked: "События по выбранным специальностям",
      },
    },
  },
  routes: {
    listing: "/events",
    eventPage: "/events",
    login: "/login",
    accountEvents: "/account/events",
  },
} satisfies EventsStorefrontHostConfig;

/**
 * What the doctor storefront states about itself so the ONE event page
 * (`@ds/event-page`) can serve it at `/events/:slug` (#2072, epic #2020 wave 3;
 * gate §4.4). DATA only: the storefront read path, the one cookie the page read
 * relays (017's remembered specialty, gate D4), the routes this host serves and
 * its breadcrumb word. Every rule and every other sentence lives in
 * `@ds/event-page`.
 */
export const DOCTOR_EVENT_PAGE = {
  contentSet: {
    pagePath: "/v1/storefront/doctor/events",
    relayCookie: DOCTOR_EVENTS_STOREFRONT.contentSet.relayCookie,
  },
  routes: {
    listing: DOCTOR_EVENTS_STOREFRONT.routes.listing,
    eventPage: DOCTOR_EVENTS_STOREFRONT.routes.eventPage,
    login: DOCTOR_EVENTS_STOREFRONT.routes.login,
    register: "/register",
  },
  copy: {
    breadcrumb: "События",
  },
} satisfies EventPageHostConfig;

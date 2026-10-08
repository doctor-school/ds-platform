import { adaptPublicEventListing } from "@ds/events-storefront/adapters";
import type { EventsStorefrontHostConfig } from "@ds/events-storefront/host-config";

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
    adapt: adaptPublicEventListing,
  },
  headerCopy: {
    title: "Расписание эфиров",
    subline: "Ближайшие эфиры",
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

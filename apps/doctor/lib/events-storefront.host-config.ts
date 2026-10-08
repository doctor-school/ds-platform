import { adaptDoctorEventsFeed } from "@ds/events-storefront/adapters";
import type { EventsStorefrontHostConfig } from "@ds/events-storefront/host-config";

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
    adapt: adaptDoctorEventsFeed,
  },
  headerCopy: {
    title: "События",
    subline: "События по вашей специальности и смежным",
  },
  routes: {
    listing: "/events",
    eventPage: "/events",
    login: "/login",
    accountEvents: "/account/events",
  },
} satisfies EventsStorefrontHostConfig;

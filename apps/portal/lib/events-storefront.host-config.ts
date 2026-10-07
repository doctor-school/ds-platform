import type { EventsStorefrontHostConfig } from "@ds/events-storefront/host-config";

/**
 * What the Academy states about itself so the shared events listing can serve
 * it (#2028, epic #2020 wave 2; gate §4.4). DATA only: the «Мои события» read,
 * the listing, event page, door and «Мои события» routes `academy.doctor.school`
 * serves, its page head and its event noun.
 * Every rule and every other sentence lives in `@ds/events-storefront`.
 */
export const ACADEMY_EVENTS_STOREFRONT = {
  contentSet: {
    myEventsPath: "/v1/me/events",
  },
  headerCopy: {
    title: "Расписание эфиров",
    subline: "Ближайшие эфиры · время — МСК",
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

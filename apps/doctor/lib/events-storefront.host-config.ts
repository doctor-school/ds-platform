import type { MyEventsHostConfig } from "@ds/events-storefront/host-config";

/**
 * What the doctor storefront states about itself so the shared events pages can
 * serve it (#1972, epic #2020 wave 2; gate §4.4). DATA only: the «Мои события»
 * read, and the event page, door and «Мои события» routes `doctor.school`
 * serves. The doctor mounts only the «Мои события» page from the package today;
 * the listing fields (page head, copy overrides, reads) land with its mount in
 * wave-2 PR 2.4. Every rule and every sentence lives in `@ds/events-storefront`.
 */
export const DOCTOR_EVENTS_STOREFRONT = {
  contentSet: {
    myEventsPath: "/v1/storefront/doctor/me/events",
  },
  routes: {
    listing: "/events",
    eventPage: "/events",
    login: "/login",
    accountEvents: "/account/events",
  },
} satisfies MyEventsHostConfig;

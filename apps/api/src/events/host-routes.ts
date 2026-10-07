import type { ParticipationRoutes } from "./participation-cta.resolver.js";

/**
 * The two storefront hosts' route tables — the only thing a host contributes to
 * the shared participation policy (020 EARS-1 / LD-1, #1764) and to the
 * «Мои события» room href (wave-2 entry gate §4.3 D8). The calling host is the
 * controller: each host's routes pass ITS table in (as D5 does for the live
 * block), so one resolution serves both hosts and they differ only in targets.
 */

/**
 * The ACADEMY host (`academy.doctor.school`): the event page under
 * `/webinars/<slug>` (004), the shipped 003 registration entry `/register` the
 * guest «Участвовать» handoff routes through, and the 006 room at
 * `/webinars/<slug>/room`.
 */
export const ACADEMY_ROUTES: ParticipationRoutes = {
  eventPath: (slug) => `/webinars/${encodeURIComponent(slug)}`,
  registrationEntry: "/register",
  roomPath: (slug) => `/webinars/${encodeURIComponent(slug)}/room`,
};

/**
 * The DOCTOR storefront host (`doctor.school`): the event page under
 * `/events/<slug>` and the shared registration entry `/register` (both
 * storefronts).
 *
 * `roomPath` resolves to this host's own room route, `/events/:slug/room`
 * (#1722, 020 §6.1): the doctor storefront MOUNTS the shared `@ds/room` unit
 * there, the same unit the Academy runs at `/webinars/:slug/room`. A registered
 * doctor on a live event resolves to `enter-room` on either host — the ACTION is
 * a fact of the event and the registration, not of the front-end — and the two
 * differ only in the target, which is exactly what this table is for.
 */
export const DOCTOR_ROUTES: ParticipationRoutes = {
  eventPath: (slug) => `/events/${encodeURIComponent(slug)}`,
  registrationEntry: "/register",
  roomPath: (slug) => `/events/${encodeURIComponent(slug)}/room`,
};

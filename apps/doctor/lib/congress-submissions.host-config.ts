import type { CongressSectionRouteHost } from "@ds/congress-submissions/route";

/**
 * 046 EARS-4 — the doctor storefront's projection of the shared
 * «Мои заявки на Конгресс» section (`@ds/congress-submissions`), as DATA: the
 * path it is mounted at (the sign-in door's return target and the account-page
 * row's href), the account page its back link returns to and the event page
 * prefix its «Страница Конгресса» link joins the event slug to, and the
 * congress site's filling guide «Как заполнить заявку ↗» (046 EARS-36).
 */
export const DOCTOR_CONGRESS_SECTION = {
  path: "/account/congress",
  accountHref: "/account",
  eventHrefPrefix: "/events/",
  fillingGuideHref: "https://orthobio.ru/participants/zapolnit-zayavku",
} as const satisfies CongressSectionRouteHost;

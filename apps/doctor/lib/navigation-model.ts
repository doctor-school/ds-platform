import type { NavigationItem, NavigationModel } from "@ds/e2e/navigation-model";

/**
 * The DOCTOR (apps/doctor) storefront navigation model — staging/regression-
 * contour tech spec §6.3 first bullet (Issue #2067).
 *
 * The sibling of `apps/portal/lib/navigation-model.ts`. Since #2180 the chrome
 * itself is `@ds/storefront-shell` and this host supplies only VALUES; this
 * module is where the DESTINATIONS among those values live. `lib/shell-config.ts`
 * derives the wordmark's target and the nav from it, `lib/shell-auth.ts` derives
 * the auth cluster's `loginHref` / `profileHref` and their copy from it, and the
 * derived navigation walk reads the same array — so the links the bar paints and
 * the links the regression contour visits are ONE list by construction.
 *
 * React-free on purpose (the walk loads it outside Next). `label` is a RUSSIAN
 * LITERAL here, not a message key: this host carries no `next-intl` (017 design
 * §7 — the storefront copy is literal), and the model's job is to hold the label
 * in the form its host already renders, byte for byte.
 *
 * `landing` carries the §6.2 evidence — the `h1` each destination paints
 * (`components/storefront-hero.tsx`, `components/login-screen.tsx`,
 * `app/(storefront)/events/page.tsx` → `DOCTOR_EVENTS_FEED_COPY.title`,
 * `components/account-screen.tsx`).
 *
 * A destination the chrome does NOT paint has no row here. `/register` is the
 * standing example: the canvas guest cluster is one combined «Войти /
 * Регистрация» control opening `/login`, which carries the way on to
 * registration (017 US-7), so `/register` is not a header destination and the
 * walk must not assert it as one.
 */
const ITEMS = {
  /** The storefront home (017 EARS-1) — the wordmark's target; `label` is its alt text. */
  home: {
    id: "home",
    label: "Doctor.School — на главную",
    href: "/",
    landing: { h1: "Doctor.School — бесплатное образование для врачей" },
    audience: "both",
  },
  /**
   * The ONE top-nav item both storefronts ship (owner decision 2026-09-10,
   * Issue #2180) — the events listing, which is also the header search target.
   */
  events: {
    id: "events",
    label: "Эфиры",
    href: "/events",
    landing: { h1: "События" },
    audience: "both",
  },
  /** The ONE guest control of the canvas (`ds-shell.dc.html` line 220, 017 US-7). */
  login: {
    id: "login",
    label: "Войти / Регистрация",
    href: "/login",
    landing: { h1: "Вход" },
    audience: "guest",
  },
  /** The signed-in labelled chip (017 EARS-1, canvas lines 192/209). */
  account: {
    id: "account",
    label: "Личный кабинет",
    href: "/account",
    landing: { h1: "Профиль" },
    audience: "doctor",
  },
} as const satisfies Record<string, NavigationItem>;

/** The chrome's destinations, indexed by route id. */
export const doctorNav = ITEMS;

/**
 * The top-nav strip, in render order — `lib/shell-config.ts` maps exactly this
 * list onto the shell's `nav`, so a nav item cannot exist outside the model.
 */
export const doctorTopNav = [ITEMS.events] as const;

/** Every destination the storefront chrome offers — what the navigation walk visits. */
export const doctorNavigationModel: NavigationModel = [
  ITEMS.home,
  ITEMS.events,
  ITEMS.login,
  ITEMS.account,
];

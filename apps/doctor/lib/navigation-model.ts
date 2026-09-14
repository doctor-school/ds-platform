import type { NavigationItem, NavigationModel } from "@ds/e2e/navigation-model";

/**
 * The DOCTOR (apps/doctor) storefront navigation model — staging/regression-
 * contour tech spec §6.3 first bullet (Issue #2067).
 *
 * The sibling of `apps/portal/lib/navigation-model.ts`, for the storefront whose
 * header (`components/storefront-header.tsx`) carried its destinations as inline
 * `href` strings. The header renders FROM this array and the derived navigation
 * walk reads the same array, so the two cannot diverge.
 *
 * React-free on purpose (the walk loads it outside Next). `label` is a RUSSIAN
 * LITERAL here, not a message key: this host carries no `next-intl` (017 design
 * §7 — the storefront copy is literal), and the model's job is to hold the label
 * in the form its host already renders, byte for byte.
 *
 * `landing` carries the §6.2 evidence — the `h1` each destination paints
 * (`components/storefront-hero.tsx`, `components/login-screen.tsx`,
 * `components/registration-screen.tsx`, `components/account-screen.tsx`).
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
  /** Guest action cluster, left chip (017 EARS-1). */
  login: {
    id: "login",
    label: "Войти",
    href: "/login",
    landing: { h1: "Вход" },
    audience: "guest",
  },
  /** Guest action cluster, right chip (021). */
  register: {
    id: "register",
    label: "Регистрация",
    href: "/register",
    landing: { h1: "Регистрация" },
    audience: "guest",
  },
  /** Signed-in action cluster (017 EARS-1). */
  account: {
    id: "account",
    label: "Личный кабинет",
    href: "/account",
    landing: { h1: "Профиль" },
    audience: "doctor",
  },
} as const satisfies Record<string, NavigationItem>;

/** The header's destinations, indexed by route id. */
export const doctorNav = ITEMS;

/** Every destination the storefront header offers — what the navigation walk visits. */
export const doctorNavigationModel: NavigationModel = [
  ITEMS.home,
  ITEMS.login,
  ITEMS.register,
  ITEMS.account,
];

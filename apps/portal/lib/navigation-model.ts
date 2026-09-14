import type { NavigationItem, NavigationModel } from "@ds/e2e/navigation-model";

/**
 * The ACADEMY (apps/portal) navigation model — staging/regression-contour tech
 * spec §6.3 first bullet (Issue #2067).
 *
 * Until this module existed, `components/app-shell-header.tsx` hard-coded
 * `DISCOVERY_HREF` / `MY_EVENTS_HREF` / `PROFILE_HREF` / `LOGIN_HREF` inline, so
 * the set of destinations the shell offers lived only inside a React component
 * — invisible to any check that does not render it. The header now renders FROM
 * this array, and the derived navigation walk reads the SAME array: a new shell
 * link enters the regression suite with zero edits to any list, and the model
 * cannot drift from what the bar actually paints.
 *
 * React-free on purpose: the walk loads this module outside Next (`@ds/e2e`
 * `hosts.ts` → `loadNavigationModel`), so it must import no component and touch
 * no browser API. `label` stays the `shell` MESSAGE KEY the header already passed
 * to `useTranslations("shell")` — moving the constant must not change one
 * rendered byte, and the key is what the header resolves.
 *
 * `landing` carries the §6.2 evidence: the `h1` each destination actually paints
 * (`messages/ru.json` → `webinars.title`, `myEvents.title`, `account.title`,
 * `login.title`), so «200 on the wrong page» is a red check rather than a pass.
 */
const ITEMS = {
  /** The discovery front-door (008 EARS-2) — the logo and «Эфиры» both target it. */
  discovery: {
    id: "discovery",
    label: "navBroadcasts",
    href: "/webinars",
    landing: { h1: "Расписание эфиров" },
    audience: "both",
  },
  /** «Мои события» (005 / 008 EARS-2). */
  "my-events": {
    id: "my-events",
    label: "navMyEvents",
    href: "/account/events",
    landing: { h1: "Мои события" },
    audience: "doctor",
  },
  /** The `/account` profile (009) — the avatar affordance's one destination. */
  profile: {
    id: "profile",
    label: "profile",
    href: "/account",
    landing: { h1: "Профиль" },
    audience: "doctor",
  },
  /** The login surface (008 EARS-4). */
  login: {
    id: "login",
    label: "login",
    href: "/login",
    landing: { h1: "Вход" },
    audience: "guest",
  },
} as const satisfies Record<string, NavigationItem>;

/**
 * The header's destinations, indexed by route id. Literal-typed so `label` stays
 * a checked `next-intl` message key at the call site (#177 type-safe i18n).
 */
export const portalNav = ITEMS;

/**
 * The top-nav strip, in render order — the desktop bar and the mobile `≡`
 * dropdown both map over exactly this list (008 EARS-2 / EARS-11: the v1 nav is
 * exactly [Эфиры · Мои события]).
 */
export const portalTopNav = [ITEMS.discovery, ITEMS["my-events"]] as const;

/** Every destination the shell offers — what the derived navigation walk visits. */
export const portalNavigationModel: NavigationModel = [
  ITEMS.discovery,
  ITEMS["my-events"],
  ITEMS.profile,
  ITEMS.login,
];

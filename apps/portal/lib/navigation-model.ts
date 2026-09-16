import type { NavigationItem, NavigationModel } from "@ds/e2e/navigation-model";

/**
 * The ACADEMY (apps/portal) navigation model — staging/regression-contour tech
 * spec §6.3, first bullet (Issue #2067).
 *
 * Since #2180 the chrome is `@ds/storefront-shell` and this host supplies only
 * VALUES; this module is where the DESTINATIONS among those values live.
 * `lib/shell-config.ts` derives the wordmark's target and the nav from it,
 * `components/academy-shell-header-client.tsx` derives the auth cluster's
 * `loginHref` / `profileHref` from it, and the derived navigation walk reads the
 * SAME array. There is one list, not a list plus a render: a new shell link
 * enters the regression suite the moment it enters the model, and the model
 * cannot drift from what the bar actually paints.
 *
 * React-free on purpose: the walk loads this module outside Next (`@ds/e2e`
 * `hosts.ts` → `loadNavigationModel`), so it must import no component and touch
 * no browser API. `label` stays the `shell` MESSAGE KEY the header resolves
 * through `useTranslations("shell")` — moving the constant must not change one
 * rendered byte, and the key is what the host resolves.
 *
 * `landing` carries the §6.2 evidence: the `h1` each destination actually paints
 * (`messages/ru.json` → `webinars.title`, `account.title`, `myEvents.title`,
 * `login.title`), so
 * «200 on the wrong page» is a red check rather than a pass.
 *
 * A destination the chrome does NOT paint has no row here. The owner decision of
 * 2026-09-10 (Issue #2180) is about the TOP NAV alone — «Эфиры» on both
 * storefronts — and `portalTopNav` is what carries it. It never covered the
 * signed-in auth cluster, which the canvas draws with «Мои события» beside the
 * avatar (`design-source/ds-shell.dc.html`, `user.links` line 209): reading it as
 * a chrome-wide rule is what dropped that link from the bar in #2198 (Issue
 * #2243). Cluster destinations therefore live in this model and in
 * `portalNavigationModel` — so the walk visits them — but NOT in `portalTopNav`.
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
  /** The `/account` profile (009) — the initials chip's one destination. */
  profile: {
    id: "profile",
    label: "profile",
    href: "/account",
    landing: { h1: "Профиль" },
    audience: "doctor",
  },
  /**
   * The signed-in doctor's «Мои события» (008 EARS-5/11) — the auth cluster's
   * second destination, beside the initials chip on desktop and in the `≡` menu
   * below the breakpoint. Canvas `user.links` line 209; NOT a top-nav item.
   */
  myEvents: {
    id: "my-events",
    label: "myEvents",
    href: "/account/events",
    landing: { h1: "Мои события" },
    audience: "doctor",
  },
  /** The login surface (008 EARS-4) — the ONE guest control's destination. */
  login: {
    id: "login",
    label: "login",
    href: "/login",
    landing: { h1: "Вход" },
    audience: "guest",
  },
} as const satisfies Record<string, NavigationItem>;

/**
 * The chrome's destinations, indexed by route id. Literal-typed so `label` stays
 * a checked `next-intl` message key at the call site (#177 type-safe i18n).
 */
export const portalNav = ITEMS;

/**
 * The top-nav strip, in render order — `lib/shell-config.ts` maps exactly this
 * list onto the shell's `nav`, which the desktop bar and the mobile menu both
 * render verbatim, so a nav item cannot exist outside the model.
 */
export const portalTopNav = [ITEMS.discovery] as const;

/** Every destination the shell offers — what the derived navigation walk visits. */
export const portalNavigationModel: NavigationModel = [
  ITEMS.discovery,
  ITEMS.profile,
  ITEMS.myEvents,
  ITEMS.login,
];

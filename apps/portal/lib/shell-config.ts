import type { StorefrontShellConfig } from "@ds/storefront-shell";

/**
 * 008 EARS-1…5 / EARS-11…14 · 013 EARS-16 — the academy storefront's HOST VALUES
 * for the shared chrome (`@ds/storefront-shell`, #2180 / epic #2020).
 *
 * Values only: the chrome composition lives once in the package and branches on
 * nothing (ADR-0013 A1). What `academy.doctor.school` renders differently from
 * `doctor.school` — the wordmark's destination, the footer columns, the giant
 * wordmark's container-query size, the routes that carry their own chrome — is a
 * value here.
 *
 * Copy is NOT hardcoded (008 EARS-13): every user-facing string is read from the
 * `shell` message catalog and handed in as {@link ShellTranslator}, so the
 * config is a projection of the catalog rather than a second copy of it.
 */

/** The discovery front-door (008 EARS-2) — the logo and «Эфиры» both point at
 *  the canonical listing rather than at `/`, which permanent-redirects there. */
export const DISCOVERY_HREF = "/webinars";

/** The `/account` profile (feature 009) — the profile chip's one destination. */
export const PROFILE_HREF = "/account";

/** The login surface (008 EARS-4). */
export const LOGIN_HREF = "/login";

/**
 * 017 EARS-12 — the ONE crossing out of this storefront. It is the doctor
 * storefront's origin, a separate deployable on a separate host (ADR-0015 §2),
 * so the link is absolute and lives in exactly one place.
 */
export const DOCTOR_ORIGIN = "https://doctor.school";

/** The `shell` catalog keys this config projects. Narrower than the namespace's
 *  full key union on purpose — a `useTranslations("shell")` translator satisfies
 *  it, and nothing here can reach a key the shell catalog does not declare. */
export type ShellConfigKey =
  | "logoAlt"
  | "topbar"
  | "navBroadcasts"
  | "footerSections"
  | "footerDocumentsTitle"
  | "footerDocuments"
  | "footerContacts"
  | "footerCrossTitle"
  | "footerCrossLabel"
  | "footerCrossNote"
  | "footerNoteBrand"
  | "footerNoteCopyright"
  | "footerGiant";

export type ShellTranslator = (key: ShellConfigKey) => string;

/**
 * The routes that carry their OWN chrome: the four auth surfaces mount
 * `AuthShell`, and the webinar room mounts `room-header`. Named once so the
 * header's list and the footer's (which adds `/` — see below) cannot drift.
 */
const HIDDEN_ON_PATHS = [
  "/login",
  "/register",
  "/verify",
  "/reset",
  "/webinars/*/room",
] as const;

/**
 * Build the academy host config from the `shell` catalog.
 *
 * `hiddenOnPaths` reproduces exactly what the portal's own header did by hand
 * before this package existed: the four auth surfaces carry their own
 * `AuthShell` chrome, and the webinar room carries its own `room-header`. The
 * patterns are matched SEGMENT-wise, so the starred room pattern below hides the
 * room of any webinar while `/webinars` and `/webinars/:slug` keep their chrome
 * — a prefix matcher would swallow the listing with it.
 */
export function academyShellConfig(t: ShellTranslator): StorefrontShellConfig {
  return {
    host: "academy",

    logo: { alt: t("logoAlt"), href: DISCOVERY_HREF },

    topbar: { text: t("topbar") },

    /**
     * No header search on this storefront: the academy has no results surface,
     * and an input that submits nowhere is the placeholder affordance AGENTS.md
     * §6 forbids. `null` makes the package render no input at all.
     */
    search: null,

    /**
     * «Эфиры» alone. The canvas draws four items on the academy artboard; the
     * owner decision of 2026-09-10 (Issue #2180, merged 008 / 017 deltas) is the
     * single shipped destination on BOTH storefronts, the nav growing with
     * features 015 / 016 and the partner surface.
     */
    nav: [{ label: t("navBroadcasts"), href: DISCOVERY_HREF }],

    footer: {
      navTitle: t("footerSections"),
      documentsTitle: t("footerDocumentsTitle"),
      documents: [
        { label: t("footerDocuments"), href: "/documents" },
        { label: t("footerContacts"), href: "/documents#contacts" },
      ],
      cross: {
        title: t("footerCrossTitle"),
        label: t("footerCrossLabel"),
        href: `${DOCTOR_ORIGIN}/`,
        note: t("footerCrossNote"),
      },
      note: [t("footerNoteBrand"), t("footerNoteCopyright")],
      giant: { text: t("footerGiant"), fontSize: "min(9.6cqw,150px)" },

      /**
       * The chrome-wide list PLUS the academy home. `/` mounts the shared
       * header like every other route (#1877), but the home view still paints
       * its own `<footer>` — a page-local section index (`#events`,
       * `#projects`, `#experts`, `#partner-form`), the «Врачи учат врачей ·
       * 2026» tagline and its own `Doctor.School` wordmark — none of which the
       * shared footer carries. Mounting both gives `/` two `contentinfo`
       * landmarks; dropping the home's own footer would drop that content.
       * Until the two footers are reconciled as one (epic #2020 owns the
       * de-duplication, and the delta is an owner-facing copy decision), the
       * shared footer stands down on `/` alone.
       */
      hiddenOnPaths: [...HIDDEN_ON_PATHS, "/"],
    },

    hiddenOnPaths: [...HIDDEN_ON_PATHS],
  };
}

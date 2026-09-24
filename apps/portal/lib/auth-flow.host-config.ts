import type {
  AuthFlowApiConfig,
  AuthFlowHostConfig,
} from "@ds/auth-flow/host-config";

import ru from "../messages/ru.json";

/**
 * What the Academy states about itself so the shared auth flow can serve it
 * (#2027, epic #2020 wave 1).
 *
 * The host value file of `@ds/auth-flow`, in the same role as `lib/room-config.ts`
 * is for `@ds/room`: the RULES (the transport, the error branch, the field
 * shapes) and every sentence a doctor reads live in the package once; the PATHS,
 * the CHANNELS, the field SET and the site key are this host's and live here.
 */

/**
 * The Academy proxies the shipped 003 routes directly — registration and
 * confirmation are the same `/v1/auth/*` commands the api has always exposed,
 * unlike the doctor storefront, which posts its own storefront commands.
 */
export const ACADEMY_AUTH_FLOW_API: AuthFlowApiConfig = {
  basePath: "/v1/auth",
  registerPath: "/v1/auth/register",
  confirmPath: "/v1/auth/verify",
};

/** The Academy's catalogue, read as DATA — this host is single-locale RU (`i18n/request.ts`). */
const m = ru;

/**
 * The full host config — a plain constant (#2027 PR 1.5).
 *
 * DATA, not a hook: the sign-in door is mounted by a server route file that can
 * only pass an imported identifier to the package. The literal `process.env.NEXT_PUBLIC_…` expression is what Next inlines at build,
 * which is why the site-key read lives in the app rather than in the package.
 */
export const ACADEMY_AUTH_FLOW = {
  api: ACADEMY_AUTH_FLOW_API,
  /**
   * The auth routes `academy.doctor.school` serves (gate §4.2), stated here as
   * LITERALS: a host config is data a route file can hand to the package, so it
   * may not reach back into `lib/` for them. `lib/auth-flow-routes.ts` re-exports
   * this table for `middleware.ts` and the server auth layouts, and a test pins
   * `login`/`account`/`room` against the navigation and room SSOTs.
   */
  routes: {
    login: "/login",
    register: "/register",
    // The Academy's confirmation is a standalone surface the verification mail
    // links into, so it has a path (the doctor storefront confirms inline).
    verify: "/verify",
    reset: "/reset",
    account: "/account",
    // 003 EARS-28 pins the `/account` change-password action as a handoff to the
    // reset flow, so a signed-in doctor must still be able to complete `/reset`.
    allowAuthenticated: ["/reset"],
    // 005 EARS-2 — the event page a carried registration intent lands on.
    eventPathTemplate: "/webinars/:slug",
    // 006 EARS-6 — the room a bounced visitor returns to; the same value
    // `@ds/room` reads from `lib/room-config.ts`.
    room: "/webinars/:slug/room",
  },
  /**
   * 014 EARS-6 — the Academy parks the carried return target in a short-lived
   * same-origin cookie, because its registration branch leaves the browser for
   * the verification mail and comes back on a cold `/verify#email=…` with no
   * query at all. The name and the lifetime are host values; the parking RULE
   * lives in `@ds/auth-flow/server`.
   */
  returnTo: {
    parkingCookie: {
      name: "ds_return_to",
      /** Long enough to open a verification mail and come back, short enough
       *  that an abandoned flow never resurfaces on an unrelated sign-in days
       *  later. */
      maxAgeSeconds: 900,
    },
  },
  // 013 EARS-15 — no carried target lands on the discovery listing, never the
  // marketing landing; this host keeps no specialty memory (row 38).
  landing: { afterLogin: "/webinars", specialtyAware: false },
  // Every auth word is the package's own default (#2027 — a field is one thing
  // on both storefronts, and the host varies only the SET of fields) EXCEPT the
  // brand panel, which is the Academy's own (owner 2026-09-24, #2027 Stage-B
  // r3): its eyebrow, headline and footer, and no sub-copy line at all.
  copy: {
    brand: {
      eyebrow: "Академия Doctor.School",
      headline: "Среда обитания экспертов здравоохранения",
      subcopy: null,
      footer: "© Doctor.School.",
    },
  },
  // The Doctor School wordmark (`public/brand/`, viewBox 500×164): the colour
  // lockup on the white form column, the clean white one on the blue panel. The
  // Academy page has no dark wordmark swap, so no `darkSrc`.
  brand: {
    wordmark: {
      src: "/brand/logo.svg",
      alt: m.brand.logoAlt,
      width: 500,
      height: 164,
    },
    panel: { src: "/brand/logo-white.svg", width: 500, height: 164 },
    loginIcon: "shield-check",
  },
  botProtection: {
    siteKey: process.env.NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY,
  },
  // The Academy serves sign-in codes over both channels, so its identifier box
  // is the email-or-E.164 union.
  channels: ["email", "sms"],
  register: { promoField: false },
  /**
   * 003 EARS-20 — what the Academy records at sign-up, and what it SHOWS.
   *
   * One required Terms-of-Service acceptance, read as ONE read-only sentence
   * rather than a checkbox group: the `statement` is what the visitor reads
   * under the credentials, the tier item is what gets recorded, and both name
   * the same purpose. The tier-1 checkbox shape is the doctor storefront's 021
   * EARS-5 decision, not this host's. The `purpose`/`wordingVersion` pair is the
   * canonical one the BFF enforces (it refuses an empty consent array).
   */
  consents: {
    tiers: [
      {
        tier: "access-conditions",
        items: [
          { purpose: "tos", required: true, statement: m.register.consent },
        ],
      },
    ],
    wordingVersion: "2026-01",
  },
} satisfies AuthFlowHostConfig;

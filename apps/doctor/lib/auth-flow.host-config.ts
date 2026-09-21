import type {
  AuthFlowApiConfig,
  AuthFlowHostConfig,
} from "@ds/auth-flow/host-config";

import { DOCTOR_AUTH_FLOW_COPY } from "../messages/auth-flow-copy";

/**
 * What the doctor storefront states about itself so the shared auth flow can
 * serve it (#2027, epic #2020 wave 1).
 *
 * The host value file of `@ds/auth-flow` on this host. A plain constant rather
 * than the Academy's hook: this storefront ships no i18n runtime. Its RU
 * sentences live in `messages/auth-flow-copy.ts` — the `*-copy.ts` name is what
 * makes them rendered UI to the repo's UI guards, and `messages/` is where this
 * host keeps them, as the Academy keeps `messages/ru.json` — and what stays here is
 * the transport, the channels and the site key, which Next inlines from the
 * literal `process.env.NEXT_PUBLIC_…` expression below.
 */

/**
 * Registration and confirmation are the storefront's OWN commands (021 EARS-19):
 * they carry the doctor profile the `/v1/auth/*` pair knows nothing about.
 * Everything else — sign-in, codes, recovery, session — is the same shared
 * `/v1/auth` surface the Academy posts to.
 */
export const DOCTOR_AUTH_FLOW_API: AuthFlowApiConfig = {
  basePath: "/v1/auth",
  registerPath: "/v1/storefront/doctor/register",
  confirmPath: "/v1/storefront/doctor/confirm",
};

export const DOCTOR_AUTH_FLOW = {
  api: DOCTOR_AUTH_FLOW_API,
  copy: DOCTOR_AUTH_FLOW_COPY,
  /**
   * The auth routes `doctor.school` serves (gate §4.2), stated here as
   * LITERALS: a host config is data a server route file hands to the package,
   * so it may not reach back into `lib/` for them. `lib/auth-flow-routes.ts`
   * re-exports this table for the auth pages' guard and the storefront layout,
   * and a test pins `login`/`account` against the navigation SSOT.
   */
  routes: {
    login: "/login",
    register: "/register",
    // No `verify`: this storefront confirms INLINE on the registration screen
    // (021 EARS-19) — there is no standalone confirmation surface to guard.
    reset: "/reset",
    account: "/account",
    // 003 EARS-28 — the `/account` change-password action hands off to the
    // reset flow, so a signed-in doctor must still be able to complete `/reset`.
    allowAuthenticated: ["/reset"],
    // 020 — the storefront event page a carried intent lands on. No `room`:
    // this storefront serves no room route.
    eventPathTemplate: "/events/:slug",
  },
  // No parking cookie: this storefront carries the target on the canonical
  // `returnTo` param (wave-1 gate row 29). It does publish the return context
  // as a card beside the door (row 46).
  returnTo: { card: true },
  // 021 EARS-3 / LD-4 — a remembered specialty lands on the events feed; no
  // specialty, or an unresolved read, lands on the storefront home. The two reads
  // are named as paths (the same ones `lib/specialty-choice.ts` issues from the
  // browser); `@ds/auth-flow/server` reads them.
  landing: {
    afterLogin: "/",
    specialtyAware: true,
    specialtyFeed: "/events",
    specialtyEndpoints: {
      signedIn: "/v1/me/specialty",
      guest: "/v1/public/specialty-choice",
      consumptionDeferredHeader: "x-ds-specialty-consumption-deferred",
    },
  },
  // The wordmark (`public/brand/`, viewBox 500×164). The form-column lockup
  // follows the class-based dark theme (#1955), so the white variant is stated.
  brand: {
    wordmark: {
      src: "/brand/logo.svg",
      darkSrc: "/brand/logo-white.svg",
      alt: "Doctor.School",
      width: 500,
      height: 164,
    },
    panel: { src: "/brand/logo-white.svg", width: 500, height: 164 },
    loginIcon: "shield-check-square",
  },
  botProtection: {
    // The prod key is the `NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY` build arg
    // (`apps/doctor/Dockerfile`); `new.doctor.school` must be an allowed domain
    // of the SmartCaptcha resource for the challenge to run there.
    siteKey: process.env.NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY,
  },
  // Sign-in codes go to email only here; the identifier box therefore refuses a
  // phone shape rather than promising a journey this storefront does not run.
  channels: ["email"],
  register: { promoField: true },
} satisfies AuthFlowHostConfig;

import { createAuthClient } from "@ds/auth-flow/client";
import type { AuthFlowApiConfig, AuthFlowHostConfig } from "@ds/auth-flow/host-config";

import { DOCTOR_AUTH_ROUTES } from "./auth-flow-routes";
import { DOCTOR_AUTH_FLOW_COPY } from "./auth-flow-copy";

/**
 * What the doctor storefront states about itself so the shared auth flow can
 * serve it (#2027, epic #2020 wave 1).
 *
 * The host value file of `@ds/auth-flow` on this host. A plain constant rather
 * than the Academy's hook: this storefront ships no i18n runtime. Its RU
 * sentences live one file over in `auth-flow-copy.ts` — the `*-copy.ts` name is
 * what makes them rendered UI to the repo's UI guards — and what stays here is
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

/** The bound transport every doctor auth screen calls. */
export const authClient = createAuthClient(DOCTOR_AUTH_FLOW_API);

export const DOCTOR_AUTH_FLOW = {
  api: DOCTOR_AUTH_FLOW_API,
  copy: DOCTOR_AUTH_FLOW_COPY,
  // The route table lives in `lib/auth-flow-routes.ts`, not inline here: the
  // auth pages' server-side guard reads it too, and this module binds the
  // browser auth client at module scope, so a server route must not import it.
  routes: DOCTOR_AUTH_ROUTES,
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

import {
  MARKETING_COMMUNICATIONS_PURPOSE,
  PARTNER_DATA_COMPOSITION,
  PARTNER_DATA_EXCLUDED,
  PARTNER_DATA_SHARING_PURPOSE,
  formatPartnerDataStatement,
} from "@ds/schemas";

import type { AuthFlowHostConfig } from "../host-config";

/**
 * The two host shapes the package units are exercised against (#2027).
 *
 * Fixtures, not the hosts' own configs: a package may not import from an app
 * (ADR-0013 A1), and the point of every case below is the BRANCH the package
 * owns, never the sentence a host chose. The sentences here therefore mirror the
 * shipped ones only closely enough that an assertion can tell two branches apart.
 */

/** The Academy: an email-or-SMS host whose registration form has no promo box. */
export const ACADEMY_FIXTURE: AuthFlowHostConfig = {
  api: {
    basePath: "/v1/auth",
    registerPath: "/v1/auth/register",
    confirmPath: "/v1/auth/verify",
  },
  routes: {
    login: "/login",
    register: "/register",
    verify: "/verify",
    reset: "/reset",
    account: "/account",
    // 003 EARS-28 - the /account change-password action hands off here, so a
    // signed-in visitor must be able to finish a reset.
    allowAuthenticated: ["/reset"],
    eventPathTemplate: "/webinars/:slug",
    room: "/webinars/:slug/room",
  },
  landing: { afterLogin: "/webinars", specialtyAware: false },
  brand: {
    wordmark: {
      src: "/brand/logo.svg",
      alt: "Doctor.School",
      width: 500,
      height: 164,
    },
    panel: { src: "/brand/logo-white.svg", width: 500, height: 164 },
    loginIcon: "shield-check",
  },
  botProtection: { siteKey: undefined },
  channels: ["email", "sms"],
  register: { promoField: false },
  // One required consent, read as ONE read-only sentence rather than a control
  // (this host's shipped render): the statement is what the visitor reads, the
  // tier item is what gets recorded, and both name the same purpose.
  consents: {
    tiers: [
      {
        tier: "access-conditions",
        items: [
          {
            purpose: "tos",
            required: true,
            statement:
              "Продолжая, вы соглашаетесь с условиями использования и политикой конфиденциальности.",
          },
        ],
      },
    ],
    wordingVersion: "2026-01",
  },
  // 014 EARS-6 - this host parks the carried target for the trip through the
  // verification mail. The doctor fixture below states none: row 29, that host
  // carries the target on the query param alone.
  returnTo: { parkingCookie: { name: "ds_return_to", maxAgeSeconds: 900 } },
};

/** The doctor storefront: email-only sign-in codes, promo box on the form. */
export const DOCTOR_FIXTURE: AuthFlowHostConfig = {
  api: {
    basePath: "/v1/auth",
    registerPath: "/v1/storefront/doctor/register",
    confirmPath: "/v1/storefront/doctor/confirm",
  },
  routes: {
    login: "/login",
    register: "/register",
    // Confirmation is an inline step of this host registration screen, not a
    // route of its own - `undefined` is that fact, not a missing value.
    reset: "/reset",
    account: "/account",
    allowAuthenticated: ["/reset"],
    eventPathTemplate: "/events/:slug",
  },
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
    registerIcon: "user-plus-square",
  },
  botProtection: { siteKey: undefined },
  channels: ["email"],
  register: {
    promoField: true,
  },
  // The two shipped tiers with the rows drawn around them: the declaration and
  // the partner-data access condition above the submit, the marketing opt-in
  // below it. The statements come from the `@ds/schemas` SSOT, so the sentence
  // and the recorded composition cannot drift apart.
  consents: {
    tiers: [
      {
        tier: "access-conditions",
        items: [
          {
            purpose: PARTNER_DATA_SHARING_PURPOSE,
            required: true,
            statement: formatPartnerDataStatement(),
            dataComposition: [...PARTNER_DATA_COMPOSITION],
            excluded: [...PARTNER_DATA_EXCLUDED],
          },
        ],
      },
      {
        tier: "marketing",
        items: [
          {
            purpose: MARKETING_COMMUNICATIONS_PURPOSE,
            required: false,
            statement:
              "Хочу получать письма о новых школах и событиях",
          },
        ],
      },
    ],
    // WHICH rows this host asks for; what each one SAYS is the package's.
    medicalWorkerDeclaration: true,
    partnerDataItem: true,
    marketingOptIn: true,
    wordingVersion: "2026-09",
  },
  // Row 46 - the doctor door publishes the return context beside the form; it
  // parks nothing (row 29), so there is no cookie here.
  returnTo: { card: true },
};

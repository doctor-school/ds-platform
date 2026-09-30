import {
  MARKETING_COMMUNICATIONS_PURPOSE,
  PARTNER_DATA_SHARING_PURPOSE,
} from "@ds/schemas";

import { consentStatementOf } from "../copy";
import { DEFAULT_AUTH_FLOW_COPY } from "../copy/defaults";
import type { AuthFlowHostConfig } from "../host-config";

/**
 * The two host shapes the package units are exercised against (#2027).
 *
 * Fixtures, not the hosts' own configs: a package may not import from an app
 * (ADR-0013 A1), and the point of every case below is the BRANCH the package
 * owns, never the sentence a host chose. The sentences here therefore mirror the
 * shipped ones only closely enough that an assertion can tell two branches apart.
 */

/** The Academy: a registration form with no promo box and one read-only consent sentence. */
export const ACADEMY_FIXTURE: AuthFlowHostConfig = {
  api: {
    basePath: "/v1/auth",
    registerPath: "/v1/auth/register",
  },
  routes: {
    login: "/login",
    register: "/register",
    verify: "/verify",
    reset: "/reset",
    account: "/account",
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
};

/** The doctor storefront: promo box on the form, specialty-aware landing, two consent tiers. */
export const DOCTOR_FIXTURE: AuthFlowHostConfig = {
  api: {
    basePath: "/v1/auth",
    registerPath: "/v1/storefront/doctor/register",
  },
  routes: {
    login: "/login",
    register: "/register",
    verify: "/verify",
    reset: "/reset",
    account: "/account",
    eventPathTemplate: "/events/:slug",
    room: "/events/:slug/room",
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
  register: {
    promoField: true,
  },
  // The two shipped tiers with the rows drawn around them: the declaration and
  // the partner-data access condition above the submit, the marketing opt-in
  // below it. Each statement is composed from the copy the door RENDERS for
  // that row, so the sentence read and the sentence recorded cannot drift.
  consents: {
    tiers: [
      {
        tier: "access-conditions",
        items: [
          {
            purpose: PARTNER_DATA_SHARING_PURPOSE,
            required: true,
            statement: consentStatementOf(
              DEFAULT_AUTH_FLOW_COPY.consents.partnerDataItem,
            ),
          },
        ],
      },
      {
        tier: "marketing",
        items: [
          {
            purpose: MARKETING_COMMUNICATIONS_PURPOSE,
            required: false,
            statement: consentStatementOf(
              DEFAULT_AUTH_FLOW_COPY.consents.marketingOptIn,
            ),
          },
        ],
      },
    ],
    // WHICH rows this host asks for; what each one SAYS is the package's.
    medicalWorkerDeclaration: true,
    partnerDataItem: true,
    marketingOptIn: true,
    wordingVersion: "2026-09-22",
  },
};

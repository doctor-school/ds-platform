"use client";

import { useTranslations } from "next-intl";

import { createAuthClient } from "@ds/auth-flow/client";
import type {
  AuthFlowApiConfig,
  AuthFlowHostConfig,
} from "@ds/auth-flow/host-config";

import { ACADEMY_AUTH_ROUTES, ACADEMY_AUTH_RETURN_TO } from "@/lib/auth-flow-routes";

/**
 * What the Academy states about itself so the shared auth flow can serve it
 * (#2027, epic #2020 wave 1).
 *
 * The host value file of `@ds/auth-flow`, in the same role as `lib/room-config.ts`
 * is for `@ds/room`: the RULES (the transport, the error branch, the field
 * shapes) live in the package once; the PATHS, the CHANNELS, the site key and
 * every sentence a doctor reads are this host's and live here.
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

/**
 * The bound transport. A module constant because the paths are static: only the
 * COPY needs the render-time translator below, and a client that waited for one
 * would make every call site a hook call.
 */
export const authClient = createAuthClient(ACADEMY_AUTH_FLOW_API);

/**
 * The full host config, resolved at render time.
 *
 * A HOOK rather than a constant for two reasons that both have to hold: the copy
 * comes from `next-intl`, which is only readable inside the React tree, and the
 * SmartCaptcha site key must be read LATE — `<AuthShell>` and its tests configure
 * the variable after import, and a module-level read would freeze the value at
 * import time. The literal `process.env.NEXT_PUBLIC_…` expression is what Next
 * inlines at build, which is why the read lives in the app rather than in the
 * package.
 */
export function useAcademyAuthFlow(): AuthFlowHostConfig {
  const te = useTranslations("errors");
  const tv = useTranslations("errors.validation");

  return {
    api: ACADEMY_AUTH_FLOW_API,
    // The route table and the parking declaration are stated in
    // `lib/auth-flow-routes.ts`, because `middleware.ts` and the four server
    // auth layouts read the same values and cannot import this client hook.
    routes: ACADEMY_AUTH_ROUTES,
    returnTo: ACADEMY_AUTH_RETURN_TO,
    copy: {
      errors: {
        tooManyAttempts: te("tooManyAttempts"),
        unavailable: te("unavailable"),
        // The same two sentences the shared challenge block already shows for
        // these states — the 403 from the guard is the SAME obstacle, so the
        // Academy says the same thing whichever layer reports it.
        botProtectionRequired: te("captchaRequired"),
        botProtectionRejected: te("captchaRejected"),
      },
      botProtection: {
        unavailable: te("captchaUnavailable"),
        rejected: te("captchaRejected"),
        required: te("captchaRequired"),
      },
      fields: {
        email: { required: tv("required"), invalid: tv("email") },
        password: { required: tv("required"), invalid: tv("passwordTooShort") },
        code: { required: tv("codeRequired"), invalid: tv("codeRequired") },
        // No `promoCode`: the Academy registration form has no promo box, and a
        // sentence for a field nothing renders would be a claim, not copy.
      },
    },
    botProtection: {
      siteKey: process.env.NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY,
    },
    // The Academy serves sign-in codes over both channels, so its identifier box
    // is the email-or-E.164 union.
    channels: ["email", "sms"],
    register: { promoField: false },
  } satisfies AuthFlowHostConfig;
}

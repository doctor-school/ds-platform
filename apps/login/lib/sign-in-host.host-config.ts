import { ACADEMY_AUTH_FLOW, DOCTOR_AUTH_FLOW } from "@ds/auth-flow/hosts";
import type { SignInHostStorefronts } from "@ds/auth-flow/server";

/**
 * The sign-in host's one host config (003 EARS-60, #3170): the two storefront
 * configs it may render, keyed by the `storefront` of the API's entry answer.
 * Data only — which one renders is the API's choice, and the transport
 * projection is `@ds/auth-flow`'s (`signInHostConfig`).
 */
export const SIGN_IN_HOST_STOREFRONTS = {
  academy: ACADEMY_AUTH_FLOW,
  doctor: DOCTOR_AUTH_FLOW,
} satisfies SignInHostStorefronts;

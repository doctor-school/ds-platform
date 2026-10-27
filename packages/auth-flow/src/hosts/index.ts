/**
 * The two storefront host configs of the shared auth flow (#3170, ADR-0013 A1).
 *
 * Each is mounted by its storefront AND by the sign-in host (ADR-0015 §4), so
 * they live here, once, instead of in either app.
 */
export {
  ACADEMY_AUTH_FLOW,
  ACADEMY_AUTH_FLOW_API,
  ACADEMY_STOREFRONT_OIDC,
} from "./academy.host-config";
export {
  DOCTOR_AUTH_FLOW,
  DOCTOR_AUTH_FLOW_API,
  DOCTOR_STOREFRONT_OIDC,
} from "./doctor.host-config";

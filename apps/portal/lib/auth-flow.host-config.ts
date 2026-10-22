import type { AccountHostConfig } from "@ds/account/host-config";
import { ACADEMY_AUTH_FLOW } from "@ds/auth-flow/hosts";

/**
 * The Academy's auth-flow config lives in `@ds/auth-flow/hosts` (#3170): the
 * sign-in host mounts the same constant, and an app never imports another app.
 * Re-exported under this file's old names, so every route file of this host
 * keeps its one import.
 */
export {
  ACADEMY_AUTH_FLOW,
  ACADEMY_AUTH_FLOW_API,
  ACADEMY_STOREFRONT_OIDC,
} from "@ds/auth-flow/hosts";

/**
 * The Academy's account cabinet config (#2073, wave-4 gate D1) — a second export
 * of this file because the cabinet reads the auth-flow config above, and a host
 * config may not import another host module. `/account` mounts `@ds/account`
 * with it.
 */
export const ACADEMY_ACCOUNT = {
  authFlow: ACADEMY_AUTH_FLOW,
  // The `events-storefront` `routes.accountEvents` value (gate row 13), stated
  // as a literal for the same reason; a test pins the two equal.
  eventsHref: "/account/events",
  // 046 EARS-4 is a doctor-storefront section: the Academy mounts none (row 14).
  congress: null,
} satisfies AccountHostConfig;

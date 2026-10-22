import type { AccountHostConfig } from "@ds/account/host-config";
import { DOCTOR_AUTH_FLOW } from "@ds/auth-flow/hosts";

/**
 * The doctor storefront's auth-flow config lives in `@ds/auth-flow/hosts`
 * (#3170): the sign-in host mounts the same constant, and an app never imports
 * another app. Re-exported under this file's old names, so every route file of
 * this host keeps its one import.
 */
export { DOCTOR_AUTH_FLOW, DOCTOR_AUTH_FLOW_API } from "@ds/auth-flow/hosts";

/**
 * The doctor storefront's account cabinet config (#2073, wave-4 gate D1) — a
 * second export of this file because the cabinet reads the auth-flow config
 * above, and a host config may not import another host module. `/account`
 * mounts `@ds/account` with it.
 */
export const DOCTOR_ACCOUNT = {
  authFlow: DOCTOR_AUTH_FLOW,
  // The `events-storefront` `routes.accountEvents` value (gate row 13), stated
  // as a literal for the same reason; a test pins the two equal.
  eventsHref: "/account/events",
  // 046 EARS-4 — the «Мои заявки на Конгресс» section this host mounts (row 14);
  // the `congress-submissions` host-config `path`, pinned equal by a test.
  congress: { path: "/account/congress" },
} satisfies AccountHostConfig;

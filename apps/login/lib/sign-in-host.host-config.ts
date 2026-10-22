import { ACADEMY_AUTH_FLOW, DOCTOR_AUTH_FLOW } from "@ds/auth-flow/hosts";
import type { SignInHostStorefronts } from "@ds/auth-flow/server";
import {
  THEME_FOUC_GUARD,
  THEME_INIT_SCRIPT,
} from "@ds/storefront-shell/theme";

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

/** How a storefront variant boots its theme on the sign-in host. */
export type SignInHostTheme = {
  /** The storefront's own pre-paint script (the shared storefront store's). */
  readonly initScript: string;
  /** Whether the storefront follows the system scheme live (mounts the watcher). */
  readonly followsSystem: boolean;
};

/**
 * Each variant's theme is its own storefront's mechanism, never a host-local
 * one (#3170): the Academy resolves a stored choice, else the system scheme,
 * and follows it live; the doctor storefront applies a stored dark choice only
 * and otherwise stays light. Keyed like {@link SIGN_IN_HOST_STOREFRONTS}.
 */
export const SIGN_IN_HOST_THEMES = {
  academy: { initScript: THEME_INIT_SCRIPT, followsSystem: true },
  doctor: { initScript: THEME_FOUC_GUARD, followsSystem: false },
} satisfies Record<keyof SignInHostStorefronts, SignInHostTheme>;

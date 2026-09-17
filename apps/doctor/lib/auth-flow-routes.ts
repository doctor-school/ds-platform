import type { AuthFlowRoutes } from "@ds/auth-flow/host-config";
import type { ServerAuth } from "@ds/auth-flow/server";
import type { ShellAuthState } from "@ds/storefront-shell";

import { doctorNav } from "@/lib/navigation-model";

/**
 * The doctor storefront's auth-flow ROUTE VALUES and its auth-cluster
 * projection (#2027 PR 1.4, wave-1 gate §4.2).
 *
 * A module of its own rather than part of `lib/auth-flow-config.ts`, for the
 * same reason the Academy splits its table out: this one is read by SERVER
 * code — the auth pages' guard and the storefront layout — while
 * `auth-flow-config.ts` binds the browser auth client at module scope.
 */

/** The auth routes `doctor.school` serves (gate §4.2). */
export const DOCTOR_AUTH_ROUTES = {
  login: "/login",
  register: "/register",
  // No `verify`: this storefront confirms INLINE on the registration screen
  // (021 EARS-19) — there is no standalone confirmation surface to guard.
  reset: "/reset",
  account: "/account",
  // 003 EARS-28 — the `/account` change-password action hands off to the reset
  // flow, so a signed-in doctor must still be able to complete `/reset`.
  allowAuthenticated: ["/reset"],
} satisfies AuthFlowRoutes;

/** The ONE guest control of the canvas (`ds-shell.dc.html` line 220) — a single
 *  combined label on both hosts (017 US-7), opening the shipped `/login`
 *  surface, which carries the way on to `/register`. */
const GUEST_LABEL = doctorNav.login.label;
/** The signed-in affordance the doctor storefront ships — a LABELLED chip
 *  (canvas lines 192/209), not the academy's initials square: this host has no
 *  display-name read in the header and 017 EARS-1 asserts the words. */
const DOCTOR_LABEL = doctorNav.account.label;

/**
 * 017 EARS-1 — project the server-resolved auth state onto the shared chrome's
 * data prop.
 *
 * This is the whole of the doctor host's auth-cluster ownership: WHICH copy the
 * chip carries and where it points. WHERE the session is read is no longer a
 * host fact at all — `@ds/auth-flow/server` `resolveServerAuth` reads it once
 * for both storefronts (#2027 PR 1.4), and the chip itself belongs to
 * `@ds/storefront-shell`, so neither can drift from the academy's.
 *
 * Omitting `initials` is what selects the labelled chip over the initials one.
 */
export function doctorShellAuthState(auth: ServerAuth): ShellAuthState {
  return auth.status === "doctor"
    ? {
        status: "doctor",
        profileHref: doctorNav.account.href,
        label: DOCTOR_LABEL,
      }
    : {
        status: "guest",
        loginHref: doctorNav.login.href,
        label: GUEST_LABEL,
      };
}

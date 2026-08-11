"use client";

import type { AuthProvider } from "@refinedev/core";
import {
  adminLogin,
  adminLogout,
  readAdminAuthState,
} from "@/lib/admin-auth";

/**
 * Refine auth provider over the **011 admin session tier**.
 *
 * What changed and why (011 EARS-1/3/6). Until this slice the admin app
 * authenticated through the doctor-portal endpoints (`/v1/auth/*`) and gated on
 * the `platform_admin` role in the returned claims. That stopped working the
 * moment 011 landed: `/v1/admin/**` now resolves its principal from
 * `__Host-ds_admin_session` alone and refuses the portal cookie outright
 * (EARS-2), so a portal session could authenticate the *provider* while every
 * admin data call behind it was refused — the client believing it was signed in
 * and the server disagreeing. There is no role check left here either, because
 * there is nothing to check: the admin tier only ever issues a session to a
 * principal the `role → mfa_required` policy covers, and only after a satisfied
 * second factor. The role gate moved from a client-side claim inspection into the
 * server-side existence of the cookie.
 *
 * **Login is not one call any more, and the provider does not pretend it is.**
 * `POST /v1/admin/auth/login` issues no session — it produces a pending
 * authentication and names the step it owes. So `login` reports success with a
 * `redirectTo` of the enrollment or challenge screen, and the session is issued
 * by *that* screen's verify (in place, LD-1 — no second sign-in). A provider that
 * resolved `authenticated: true` here would let Refine paint the admin shell over
 * a principal who has presented one factor.
 *
 * `check` is the one read the whole flow routes on ({@link readAdminAuthState}) —
 * the three cookies that hold the answer are `HttpOnly`, so the state is a server
 * read by construction, not a cookie sniff.
 */
const ADMIN_ROOT = "/events";
const LOGIN_PATH = "/login";
const ENROLL_PATH = "/mfa/enroll";
const CHALLENGE_PATH = "/mfa/challenge";

export const authProvider: AuthProvider = {
  login: async ({ email, password }: { email?: string; password?: string }) => {
    const result = await adminLogin(email ?? "", password ?? "");
    if (!result.ok) {
      return {
        success: false,
        error: {
          name: "LoginError",
          // One message for every primary-auth refusal — wrong password, unknown
          // account, a principal outside the policy, a locked account. The API
          // answers all of them identically (ADR-0001 §7 enumeration safety) and
          // a client-side taxonomy would leak exactly what it refused to say.
          message: result.throttled
            ? "login.errorThrottled"
            : "login.errorGeneric",
        },
      };
    }
    // Primary auth succeeded and issued NO session: send the operator to the step
    // they owe. `success: true` here means "the password was right", which is
    // what the login form needs to know; `check` still reports them
    // unauthenticated until a factor is satisfied.
    return {
      success: true,
      redirectTo:
        result.value === "mfa_pending_challenge" ? CHALLENGE_PATH : ENROLL_PATH,
    };
  },

  logout: async () => {
    await adminLogout();
    return { success: true, redirectTo: LOGIN_PATH };
  },

  check: async () => {
    const state = await readAdminAuthState();
    if (state === "active") return { authenticated: true };
    // A principal mid-flow is NOT authenticated — but bouncing them to `/login`
    // would throw away a live pending authentication and make them re-enter
    // their password. Route them at the step they actually owe.
    if (state === "mfa_pending_challenge") {
      return { authenticated: false, redirectTo: CHALLENGE_PATH };
    }
    if (state === "mfa_pending_enrollment") {
      return { authenticated: false, redirectTo: ENROLL_PATH };
    }
    return { authenticated: false, redirectTo: LOGIN_PATH, logout: true };
  },

  onError: async (error) => {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 401 || status === 403) {
      return { logout: true, redirectTo: LOGIN_PATH, error };
    }
    return {};
  },

  /**
   * The admin tier deliberately exposes no claims read: `AdminAuthState` is the
   * state enum and nothing else (011 design §9 → Read models), because a
   * merely-primary-authenticated caller must learn nothing about the account. So
   * a resolved admin session means exactly one permission — being in admin —
   * and that is what this reports. The `accessControlProvider` and the api's own
   * `AuthzGuard` remain the authority for every individual action.
   */
  getPermissions: async () => {
    const state = await readAdminAuthState();
    return state === "active" ? ["platform_admin"] : [];
  },

  /**
   * The admin tier exposes no identity read by design (see `getPermissions`):
   * `AdminAuthState` carries no subject, no email, no claims. So this resolves
   * the fact of an admin session and **no display name** — nothing in the admin
   * shell renders one today, and fabricating a label the server never asserted
   * would be a user-facing invention, which is worse than an absent one.
   */
  getIdentity: async () => {
    const state = await readAdminAuthState();
    return state === "active" ? { id: "admin" } : null;
  },
};

export { ADMIN_ROOT, CHALLENGE_PATH, ENROLL_PATH, LOGIN_PATH };

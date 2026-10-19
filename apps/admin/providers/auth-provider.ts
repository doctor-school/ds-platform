"use client";

import type { AuthProvider } from "@refinedev/core";
import { adminLogin, adminLogout, readAdminAuthState } from "@/lib/admin-auth";
import { clearAdminSession } from "@/lib/admin-session-cache";
import { loginFailureMessage } from "@/lib/login-failure";
import { browserStepUpStorage, clearStepUpRequest } from "@/lib/step-up";
import {
  ADMIN_LANDING,
  currentPageAsReturnTarget,
  withAdminReturnTarget,
} from "@/lib/admin-return-target";

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
const ADMIN_ROOT = ADMIN_LANDING;
const LOGIN_PATH = "/login";
const ENROLL_PATH = "/mfa/enroll";
const CHALLENGE_PATH = "/mfa/challenge";

/**
 * End the session here and in this tab: the server-side sign-out, the cached
 * session read and a pending step-up grant. Shared by `logout` and the 401
 * path of `onError`.
 */
async function signOut(): Promise<void> {
  await adminLogout();
  // 044 EARS-20: the cached session read (nav + `can`) belongs to the principal
  // who just left; the next sign-in in this tab re-reads its own.
  clearAdminSession();
  // 047 EARS-8: a grant the step-up interrupted belongs to this session only;
  // it is never sent under the next one (the 401 path signs out through here).
  clearStepUpRequest(browserStepUpStorage());
}

export const authProvider: AuthProvider = {
  login: async ({
    email,
    password,
    to,
  }: {
    email?: string;
    password?: string;
    /** #2782 — the page the operator came from; validated before it is carried. */
    to?: string | null;
  }) => {
    // 044 EARS-20: a new sign-in is a new principal — never draw the last one's nav.
    clearAdminSession();
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
          //
          // The two carve-outs describe the SERVICE, not the account, so neither
          // can leak what the uniform 401 hides: the 429 rate limit, and the 503
          // IdP outage (#1212) where the credentials were never checked at all —
          // reporting THAT as «проверьте данные» is a false verdict (#1217).
          // Refine carries a single string here, so the refusal crosses as its
          // catalog key and the screen re-reads it (`login-failure.ts`).
          message: loginFailureMessage(result),
        },
      };
    }
    // Primary auth succeeded and issued NO session: send the operator to the step
    // they owe. `success: true` here means "the password was right", which is
    // what the login form needs to know; `check` still reports them
    // unauthenticated until a factor is satisfied. The return target (#2782)
    // rides on to that step, which lands the operator on it once satisfied.
    return {
      success: true,
      redirectTo: withAdminReturnTarget(
        result.value === "mfa_pending_challenge" ? CHALLENGE_PATH : ENROLL_PATH,
        to,
      ),
    };
  },

  logout: async () => {
    await signOut();
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

  /**
   * Only a 401 means the session is gone, so only a 401 signs the operator out.
   * A 403 is a refusal of THIS action by a live session (ADR-0001 A1: the
   * console treats it as no-access, never a retry and never a logout) — e.g. a
   * registrar whose event binding was withdrawn (044 EARS-38). The screen that
   * made the call owns what it shows; logging out here would race it to
   * `/login` and hide the refusal.
   *
   * 047 EARS-8 — a `401 STEP_UP_REQUIRED` is not a lost session either: the
   * session is live and only its second factor is older than 30 minutes
   * (ADR-0001 §10). The screen that sent the request keeps it and takes the
   * operator to the code screen (`lib/step-up.ts`); signing out here would
   * throw away the session and the entered form.
   *
   * #2782: the 401 carries the page the operator was on (`?to=`), so the sign-in
   * returns them there — the same parameter `<Authenticated>` appends for an
   * unauthenticated page load. A sign-in screen is never carried (no loops).
   *
   * #2998: the 401 path signs out itself and returns only the redirect — never
   * `logout: true`. Refine's logout hook invalidates the auth store while the
   * refused page is still mounted, so `<Authenticated>` unmounts and remounts
   * it; the remount re-sends the refused read, whose 401 signs out again — a
   * burst of identical refused requests until the navigation commits. Here the
   * refused read is sent once and the redirect follows it.
   */
  onError: async (error) => {
    const { statusCode: status, errorCode } = error as {
      statusCode?: number;
      errorCode?: string;
    };
    if (status === 401 && errorCode === "STEP_UP_REQUIRED") {
      return { error };
    }
    if (status === 401) {
      await signOut();
      return {
        redirectTo: withAdminReturnTarget(
          LOGIN_PATH,
          currentPageAsReturnTarget(),
        ),
        error,
      };
    }
    if (status === 403) {
      return { error };
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

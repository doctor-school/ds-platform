"use client";

import type {
  AdminAuthState,
  AdminAuthStateResponse,
  AdminEnrollmentOffer,
} from "@ds/schemas";

/**
 * The admin tier's own auth surface (011), reached the same way every other admin
 * call is: the relative `/v1/admin/auth/*` path with `credentials: "include"`, so
 * the host-only `__Host-ds_admin_*` cookies are set and sent same-origin through
 * the admin proxy (`next.config.ts`).
 *
 * This module is the ONLY place the admin app talks to the auth tier. Nothing
 * here handles a token, a pending reference, or a session id: those live in
 * `HttpOnly` cookies the browser attaches and this code cannot read — which is
 * exactly why {@link readAdminAuthState} exists. The one secret that ever crosses
 * this boundary is the enrollment offer, rendered once and never stored.
 */
const ADMIN_AUTH_BASE = "/v1/admin/auth";

/** EARS-10: the readable half of the CSRF double-submit pair (NOT `HttpOnly`). */
export const ADMIN_CSRF_COOKIE_NAME = "__Host-ds_admin_csrf";

/** EARS-10: the header the admin app echoes {@link ADMIN_CSRF_COOKIE_NAME} into. */
export const ADMIN_CSRF_HEADER = "x-ds-admin-csrf";

/**
 * Outcome of an admin-auth call — one uniform refusal, plus two carve-outs that
 * are not refusals OF THE SUBMITTED CREDENTIAL at all.
 *
 * Every refusal the API makes is one uniform 401 (EARS-7): a wrong code, an
 * expired window, a replay, a soft-locked account, a stale pending reference.
 * The client does not get to invent a taxonomy the server refused to expose — so
 * that arm carries no reason, and the screens render one message for all of them.
 *
 * The two flags below are carve-outs precisely because neither describes the
 * account, so neither can leak what the 401 spends a clause hiding:
 *
 * - `throttled` (**429**) — the ADR-0001 §7 rate limit reporting the CALLER's own
 *   attempt rate. An operator told "try again in a moment" is better served than
 *   one told their correct code is wrong.
 * - `outage` (**503**) — `IdpUnavailableError`: the verification service is down,
 *   so the code was never checked and no attempt budget was spent (#1212). Folding
 *   it into the uniform message tells an operator holding a CORRECT code that the
 *   code is wrong and sends them to re-check a phone clock that is fine — the
 *   #1213 defect. Honest unavailability is disclosed; account state is not.
 */
export type AdminAuthResult<T> =
  | { ok: true; value: T }
  | { ok: false; refused: true; throttled?: boolean; outage?: boolean };

function refusal(res: Response): {
  ok: false;
  refused: true;
  throttled?: boolean;
  outage?: boolean;
} {
  if (res.status === 503) return { ok: false, refused: true, outage: true };
  return res.status === 429
    ? { ok: false, refused: true, throttled: true }
    : { ok: false, refused: true };
}

/**
 * EARS-10: the CSRF double-submit header for a state-changing admin request.
 *
 * The value is read from the deliberately-readable `__Host-ds_admin_csrf` cookie
 * and echoed into {@link ADMIN_CSRF_HEADER}. It authenticates nothing by itself —
 * it proves the request was composed by script running at the admin origin, which
 * a cross-site caller cannot do because it cannot read the cookie. Absent (not
 * yet logged in), this resolves to an empty header set and the API refuses the
 * request, which is the correct fail-closed answer.
 */
export function adminCsrfHeaders(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const match = new RegExp(
    `(?:^|; )${ADMIN_CSRF_COOKIE_NAME}=([^;]*)`,
  ).exec(document.cookie);
  return match?.[1] ? { [ADMIN_CSRF_HEADER]: decodeURIComponent(match[1]) } : {};
}

/**
 * 011 EARS-6: where does this browser belong — the login form, enrollment,
 * challenge, or the app?
 *
 * A server read, not a cookie sniff: `__Host-ds_admin_session` and
 * `__Host-ds_admin_pending` are `HttpOnly` by design, so the app cannot see them.
 * The response is the state enum and nothing else (no budget, no lock, no
 * subject), so a caller who has passed primary auth at most learns nothing about
 * the account they are attacking. Any transport fault resolves `unauthenticated`
 * — the fail-closed answer, which lands the operator on the login form rather
 * than in a half-rendered admin shell.
 */
export async function readAdminAuthState(): Promise<AdminAuthState> {
  try {
    const res = await fetch(`${ADMIN_AUTH_BASE}/state`, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return "unauthenticated";
    return ((await res.json()) as AdminAuthStateResponse).state;
  } catch {
    return "unauthenticated";
  }
}

/**
 * 011 EARS-3: primary password authentication at the admin origin.
 *
 * It issues **no session** — success means a short-lived pending authentication
 * exists and the response says which second-factor step it owes. The caller
 * routes on that state; there is nothing else to do with it.
 */
export async function adminLogin(
  identifier: string,
  password: string,
): Promise<
  AdminAuthResult<
    Extract<
      AdminAuthState,
      "mfa_pending_enrollment" | "mfa_pending_challenge"
    >
  >
> {
  const res = await fetch(`${ADMIN_AUTH_BASE}/login`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok) return refusal(res);
  const body = (await res.json()) as {
    state: "mfa_pending_enrollment" | "mfa_pending_challenge";
  };
  return { ok: true, value: body.state };
}

/**
 * 011 EARS-5: register a provisional TOTP factor and fetch the one-time offer.
 *
 * A 401 means this caller is not a pending-enrollment principal (no pending
 * cookie, an expired one, or one owing a different step) — the screen sends them
 * back to the login form rather than rendering an empty card.
 */
export async function startMfaEnrollment(): Promise<
  AdminAuthResult<AdminEnrollmentOffer>
> {
  const res = await fetch(`${ADMIN_AUTH_BASE}/mfa/enroll/start`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: "{}",
  });
  if (!res.ok) return refusal(res);
  return { ok: true, value: (await res.json()) as AdminEnrollmentOffer };
}

/**
 * 011 EARS-5: submit the first code. On success the API has registered the factor
 * and upgraded the pending authentication **in place** into
 * `__Host-ds_admin_session` (LD-1) — the session cookie rides that response, so
 * the caller simply navigates into the admin surface; there is no second login to
 * orchestrate.
 */
export async function verifyMfaEnrollment(
  code: string,
): Promise<AdminAuthResult<void>> {
  return submitCode(`${ADMIN_AUTH_BASE}/mfa/enroll/verify`, code);
}

/**
 * 011 EARS-6: submit the challenge code. Identical contract to the enrollment
 * verify — and identical on purpose: the two surfaces must be indistinguishable
 * to a caller (EARS-7), so the client cannot afford to treat them differently
 * either.
 */
export async function verifyMfaChallenge(
  code: string,
): Promise<AdminAuthResult<void>> {
  return submitCode(`${ADMIN_AUTH_BASE}/mfa/verify`, code);
}

async function submitCode(
  url: string,
  code: string,
): Promise<AdminAuthResult<void>> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) return refusal(res);
  return { ok: true, value: undefined };
}

/**
 * 011 EARS-2: end the admin session. Carries the EARS-10 double-submit header
 * (this is a state-changing admin route) and clears only the admin cookie pair —
 * a concurrent doctor-portal session is deliberately untouched.
 */
export async function adminLogout(): Promise<void> {
  try {
    await fetch(`${ADMIN_AUTH_BASE}/logout`, {
      method: "POST",
      credentials: "include",
      headers: { accept: "application/json", ...adminCsrfHeaders() },
    });
  } catch {
    // The operator is leaving either way: the client-side navigation to /login
    // must not hinge on the network. A session left server-side expires on its
    // own TTL, and the next `readAdminAuthState` re-derives the truth.
  }
}

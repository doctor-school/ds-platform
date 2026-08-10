"use client";

import type { AdminEnrollmentOffer } from "@ds/schemas";

/**
 * The admin tier's own auth surface (011), reached the same way every other admin
 * call is: the relative `/v1/admin/auth/*` path with `credentials: "include"`, so
 * the host-only `__Host-ds_admin_*` cookies are set and sent same-origin through
 * the admin proxy (`next.config.ts`).
 *
 * These endpoints are the ONLY ones a `mfa_pending_enrollment` principal can
 * reach (EARS-4) — every other admin route refuses the pending reference
 * server-side. The pending reference itself never appears here: it lives in an
 * `HttpOnly` cookie the browser attaches, which is why this module handles no
 * token, no reference, and no secret beyond the one render of the offer.
 */
const ADMIN_AUTH_BASE = "/v1/admin/auth";

/** Outcome of an enrollment call — deliberately two-valued, mirroring the API. */
export type EnrollmentResult<T> =
  | { ok: true; value: T }
  /**
   * Every refusal the API makes is one uniform 401 (EARS-7): a wrong code, an
   * expired window, a replay, a stale pending reference. The client does not get
   * to invent a taxonomy the server refused to expose — so this carries no
   * reason, and the screen renders one message for all of them.
   */
  | { ok: false; refused: true };

/**
 * EARS-5: register a provisional TOTP factor and fetch the one-time offer.
 *
 * A 401 means this caller is not a pending-enrollment principal (no pending
 * cookie, an expired one, or one owing a different step) — the screen sends them
 * back to the login form rather than rendering an empty card.
 */
export async function startMfaEnrollment(): Promise<
  EnrollmentResult<AdminEnrollmentOffer>
> {
  const res = await fetch(`${ADMIN_AUTH_BASE}/mfa/enroll/start`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: "{}",
  });
  if (!res.ok) return { ok: false, refused: true };
  return { ok: true, value: (await res.json()) as AdminEnrollmentOffer };
}

/**
 * EARS-5: submit the first code. On success the API has registered the factor and
 * upgraded the pending authentication **in place** into `__Host-ds_admin_session`
 * (LD-1) — the session cookie rides that response, so the caller simply navigates
 * into the admin surface; there is no second login to orchestrate.
 */
export async function verifyMfaEnrollment(
  code: string,
): Promise<EnrollmentResult<void>> {
  const res = await fetch(`${ADMIN_AUTH_BASE}/mfa/enroll/verify`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) return { ok: false, refused: true };
  return { ok: true, value: undefined };
}

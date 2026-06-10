"use client";

import { AuthError } from "@/lib/auth-client";

/**
 * Map an auth-call failure to a user-facing RU message (#175, the comment rule).
 *
 * Every portal auth call throws {@link AuthError}`{ status, message }` on a
 * non-2xx, but the pages historically discarded the status and showed one
 * hardcoded generic for every failure — so a 429 rate-limit looked identical to
 * a wrong password. The product rule: surface a SPECIFIC, actionable message
 * wherever it is safe to do so, and stay generic ONLY where EARS-16
 * enumeration-resistance demands it.
 *
 * The branch is therefore on whether the status is an *account oracle*:
 *   • 429 (rate limit — per-IP/ASN/global, never per-account) → actionable
 *     "too many attempts" copy. Not an existence oracle.
 *   • 5xx, or a thrown non-`AuthError` (network/transport/programming failure,
 *     e.g. `fetch` rejecting) → "service temporarily unavailable". Availability,
 *     not an oracle.
 *   • everything else — 400/401 and any other status, i.e. the actual
 *     authentication OUTCOME (wrong credential / unknown account / failed
 *     factor) → the per-action `fallbackGeneric`. EARS-16: this MUST stay
 *     neutral so the UI never leaks whether the account exists or which factor
 *     failed.
 *
 * @param err              the caught error (typed `AuthError` or anything else)
 * @param t                the `errors` namespace translator (next-intl `useTranslations("errors")`)
 * @param fallbackGeneric  the already-resolved per-action generic string (e.g. `t("loginFailed")`)
 */
export function authErrorMessage(
  err: unknown,
  t: (key: string) => string,
  fallbackGeneric: string,
): string {
  if (err instanceof AuthError) {
    if (err.status === 429) return t("tooManyAttempts");
    if (err.status >= 500) return t("unavailable");
    // 400 / 401 / any other status = the auth outcome → stay EARS-16-generic.
    return fallbackGeneric;
  }
  // A non-AuthError escaped the call: `fetch` rejected (offline / DNS / TLS) or a
  // programming error. Transport-class, not an oracle → actionable "unavailable".
  return t("unavailable");
}

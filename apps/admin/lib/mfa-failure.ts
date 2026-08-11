/**
 * 011 EARS-7/EARS-12 — how a refused MFA call is presented, decided in ONE place
 * for both MFA screens (`/mfa/enroll` and `/mfa/challenge`).
 *
 * The two screens must stay indistinguishable to a caller (EARS-7), so their
 * failure rendering is not written twice: they read this mapping and render it.
 *
 * **Why an outage is a WARNING, not a DANGER (#1213).** A `danger` alert reading
 * «Код не подошёл» is a verdict on what the operator just typed. When the API
 * answers 503 the code was never checked at all — the IdP is down (#1212) — so
 * that verdict is false, and it sends an operator with a correct code chasing a
 * phone clock that is fine. The outage state says what is actually true, in the
 * same slot, with the submit button left active: the service may come back within
 * the minute and a re-submit is the right next move (Stage-A, owner-approved
 * 2026-08-11 on #1213 — no cooldown, no countdown, no disabled control).
 */

/** The `messages/ru.json` key, resolved under the calling screen's own block. */
export type MfaFailureMessageKey =
  | "errorGeneric"
  | "errorThrottled"
  | "errorOutage";

export interface MfaFailurePresentation {
  /** Catalog key — resolved with `useTranslations("mfaEnroll" | "mfaChallenge")`. */
  messageKey: MfaFailureMessageKey;
  /** `@ds/design-system` `Alert` variant (`warn` carries the amber tint + role=alert). */
  variant: "warn" | "danger";
  /**
   * Distinct testids on purpose: a test asserting "the operator was NOT told their
   * code is wrong" has to be able to fail, which a shared testid makes impossible.
   */
  testId: "mfa-outage" | "mfa-error";
}

/**
 * Map a refused {@link import("./admin-auth").AdminAuthResult} onto what the screen
 * shows. `outage` is checked first: when the verification service is unreachable
 * the attempt was never counted, so a rate-limit story would be doubly wrong.
 */
export function mfaFailurePresentation(refusal: {
  throttled?: boolean;
  outage?: boolean;
}): MfaFailurePresentation {
  if (refusal.outage) {
    return { messageKey: "errorOutage", variant: "warn", testId: "mfa-outage" };
  }
  if (refusal.throttled) {
    return {
      messageKey: "errorThrottled",
      variant: "danger",
      testId: "mfa-error",
    };
  }
  return { messageKey: "errorGeneric", variant: "danger", testId: "mfa-error" };
}

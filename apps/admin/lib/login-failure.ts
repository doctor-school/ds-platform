/**
 * 011 EARS-3 — how a refused primary authentication is presented on the login
 * screen, decided in ONE place (the login page and the Refine auth provider read
 * the same mapping, so the message the provider surfaces and the alert the screen
 * paints cannot drift apart).
 *
 * **Why an outage is a WARNING, not a DANGER (#1217).** A `danger` alert reading
 * «Не удалось войти. Проверьте данные» is a verdict on the email and password the
 * operator just typed. When the API answers 503 those were never checked at all —
 * the IdP is down (#1212) — so the verdict is false, and it sends an operator
 * holding correct credentials hunting a typo that does not exist. The outage state
 * says what is actually true, in the same slot, with the submit button left active
 * and the typed input kept: the service may come back within the minute and a
 * re-submit is the right next move (Stage-A, owner-approved 2026-08-11 on #1217 —
 * no cooldown, no countdown, no disabled control). This mirrors the MFA screens'
 * `mfa-failure.ts` deliberately: an operator who meets the outage wording on one
 * admin auth screen meets the same shape on the other.
 *
 * 401 and 429 are untouched. Every refusal OF THE CREDENTIALS is one uniform 401
 * (wrong password, unknown account, a principal outside the `role → mfa_required`
 * policy, a locked account) — the API answers them identically (ADR-0001 §7
 * enumeration safety) and a client-side taxonomy would leak exactly what it
 * refused to say. 429 reports the CALLER's own attempt rate, and 503 the state of
 * the service; neither describes the account, so neither can leak it.
 */

/** The `messages/ru.json` key, resolved under the screen's `login` block. */
export type LoginFailureMessageKey =
  | "errorGeneric"
  | "errorThrottled"
  | "errorOutage";

export interface LoginFailurePresentation {
  /** Catalog key — resolved with `useTranslations("login")`. */
  messageKey: LoginFailureMessageKey;
  /** `@ds/design-system` `Alert` variant (`warn` carries the amber tint + role=alert). */
  variant: "warn" | "danger";
  /**
   * Distinct testids on purpose: a test asserting "the operator was NOT told their
   * credentials are wrong" has to be able to fail, which a shared testid makes
   * impossible.
   */
  testId: "login-outage" | "login-error";
}

/** The `login` block prefix the provider's Refine error message carries. */
const CATALOG_PREFIX = "login.";

/**
 * Map a refused {@link import("./admin-auth").AdminAuthResult} onto what the login
 * screen shows. `outage` is checked first: when the identity service is
 * unreachable the attempt was never counted, so a rate-limit story would be doubly
 * wrong.
 */
export function loginFailurePresentation(refusal: {
  throttled?: boolean;
  outage?: boolean;
}): LoginFailurePresentation {
  if (refusal.outage) {
    return {
      messageKey: "errorOutage",
      variant: "warn",
      testId: "login-outage",
    };
  }
  if (refusal.throttled) {
    return {
      messageKey: "errorThrottled",
      variant: "danger",
      testId: "login-error",
    };
  }
  return { messageKey: "errorGeneric", variant: "danger", testId: "login-error" };
}

/**
 * The catalog path the auth provider puts on Refine's `error.message`.
 *
 * Refine's `login` result carries a single string, not an object — so the refusal
 * crosses that boundary as its catalog key and is re-read by the screen with
 * {@link loginFailureFromMessage}. That round trip is the only reason a 503 keeps
 * its identity all the way to the rendered alert.
 */
export function loginFailureMessage(refusal: {
  throttled?: boolean;
  outage?: boolean;
}): string {
  return `${CATALOG_PREFIX}${loginFailurePresentation(refusal).messageKey}`;
}

/**
 * Re-read a message produced by {@link loginFailureMessage}.
 *
 * Anything else — an absent message, or a transport error string Refine surfaced
 * from a thrown `fetch` — resolves the uniform refusal: the screen must render a
 * sentence in every case, and inventing an outage claim from an unrecognised
 * string would be a worse lie than the generic one.
 */
export function loginFailureFromMessage(
  message: string | undefined,
): LoginFailurePresentation {
  switch (message) {
    case `${CATALOG_PREFIX}errorOutage`:
      return loginFailurePresentation({ outage: true });
    case `${CATALOG_PREFIX}errorThrottled`:
      return loginFailurePresentation({ throttled: true });
    default:
      return loginFailurePresentation({});
  }
}

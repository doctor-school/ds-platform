/**
 * 044 EARS-9 — the ONE consent purpose the public congress intake records.
 *
 * The participant accepts a single personal-data text published on the congress
 * site, and that acceptance is the only consent this surface captures. The
 * literal lives in the API-contract SSOT for the same reason the 021 purposes do
 * (`packages/schemas/src/storefront/doctor-register.schema.ts`): the congress
 * form, the intake service and the `consent_records` row must all name one
 * string, and a copy of it in an app is exactly the divergence this constant
 * exists to prevent.
 *
 * Deliberately NOT `medical-worker-declaration`: 044 EARS-10 requires that the
 * declaration is neither recorded nor demanded on this surface — a congress
 * sign-up is not a platform registration.
 */
export const CONGRESS_PERSONAL_DATA_PURPOSE = "congress-personal-data";

/**
 * 044 EARS-9 — every purpose the congress intake is willing to record, as a
 * CLOSED list with exactly one member.
 *
 * A one-member closed list is not ceremony: the 003 `ConsentAcceptanceSchema`
 * accepts any non-empty purpose string because 003 is the engine and does not
 * know which text a given surface renders. 044 does — it renders exactly one —
 * so the list is closed at this surface's own boundary, and the server's
 * `Record<purpose, version>` version table is typed against it, which makes
 * adding a purpose here without its server-stamped version a compile error.
 */
export const CONGRESS_SIGN_UP_CONSENT_PURPOSES = [
  CONGRESS_PERSONAL_DATA_PURPOSE,
] as const;

export type CongressSignUpConsentPurpose =
  (typeof CONGRESS_SIGN_UP_CONSENT_PURPOSES)[number];

/**
 * Is this purpose one the 044 congress surface actually renders?
 *
 * Exported as a guard rather than kept private because the same closed list is
 * restated in the API as a domain rule — a caller reaching the service without
 * the DTO pipe must meet it too — and the two must not drift.
 */
export const isCongressSignUpConsentPurpose = (
  purpose: string,
): purpose is CongressSignUpConsentPurpose =>
  (CONGRESS_SIGN_UP_CONSENT_PURPOSES as readonly string[]).includes(purpose);

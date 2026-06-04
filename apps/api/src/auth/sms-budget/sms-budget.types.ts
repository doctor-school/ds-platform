/**
 * SMS toll-fraud budget contract (EARS-14, design §10).
 *
 * SMS itself is sent natively by Zitadel (`otp_sms`); this budget is the custom
 * BFF half of the native-vs-custom split (design §2 — "SMS OTP code → toll-fraud
 * guard + daily budget"). It gates **before** the BFF asks the IdP to send, so a
 * refused send never reaches the provider and never costs money.
 */

/**
 * The four EARS-14 ceilings. Per-phone / per-IP / per-ASN are hourly; the global
 * budget is the daily circuit-breaker. Injected (not hard-coded) so a deployment
 * can tighten them and tests can drive the boundary without 2000 round-trips.
 */
export interface SmsBudgetThresholds {
  perPhonePerHour: number;
  perIpPerHour: number;
  perAsnPerHour: number;
  globalPerDay: number;
}

/** The EARS-14 defaults: per-phone 3/h, per-IP 10/h, per-ASN 100/h, ≤2000/day. */
export const DEFAULT_SMS_BUDGET_THRESHOLDS: SmsBudgetThresholds = {
  perPhonePerHour: 3,
  perIpPerHour: 10,
  perAsnPerHour: 100,
  globalPerDay: 2000,
};

/** Monotonic-enough wall clock (ms). Injected so window resets are testable. */
export type Clock = () => number;

/**
 * The request dimensions a single attempted SMS send is keyed by. `asn` is
 * supplied by the edge (the per-ASN limit is an edge/BFF concern, design §2);
 * when absent the per-ASN window cannot bucket the request and is skipped, so the
 * guard degrades to phone/IP/global rather than refusing blindly.
 */
export interface SmsSendContext {
  phone: string;
  ip: string;
  asn?: string | undefined;
}

/** DI token for {@link SmsBudgetThresholds} (env-overridable in the module). */
export const SMS_BUDGET_THRESHOLDS = Symbol("SMS_BUDGET_THRESHOLDS");

/** DI token for the {@link Clock} (defaults to `Date.now`; a fake in tests). */
export const SMS_BUDGET_CLOCK = Symbol("SMS_BUDGET_CLOCK");

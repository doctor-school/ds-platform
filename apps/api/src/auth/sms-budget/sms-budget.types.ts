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

/**
 * Env var name per EARS-14 ceiling (#3047), the sibling of the EARS-13
 * `RATE_LIMIT_ENV_VARS` (#1076). A test stand that plays the whole suite from
 * ONE runner address (the stage slots) lifts the per-IP / per-ASN ceilings here
 * instead of failing on a false 429; production sets none of them. Each is
 * optional and independent: unset ⇒ that ceiling's default; a valid positive
 * integer ⇒ overrides ONLY that field.
 */
export const SMS_BUDGET_ENV_VARS = {
  perPhonePerHour: "SMS_BUDGET_PER_PHONE_1H",
  perIpPerHour: "SMS_BUDGET_PER_IP_1H",
  perAsnPerHour: "SMS_BUDGET_PER_ASN_1H",
  globalPerDay: "SMS_BUDGET_GLOBAL_1D",
} as const satisfies Record<keyof SmsBudgetThresholds, string>;

/** The four raw env values the {@link resolveSmsBudgetThresholds} factory reads. */
export type SmsBudgetEnv = {
  [K in (typeof SMS_BUDGET_ENV_VARS)[keyof typeof SMS_BUDGET_ENV_VARS]]?:
    string | undefined;
};

/** A rejected override: which env var, and the raw value that failed validation. */
export interface SmsBudgetOverrideRejection {
  envVar: string;
  rawValue: string;
}

/**
 * Resolve the effective EARS-14 thresholds by overlaying only the env vars that
 * hold a valid **positive integer** onto {@link DEFAULT_SMS_BUDGET_THRESHOLDS}
 * (#3047) — the same fail-SAFE contract as `resolveRateLimitThresholds`:
 *
 * - unset / empty / whitespace ⇒ that ceiling keeps its default (no rejection);
 * - a valid positive integer ⇒ overrides ONLY that field;
 * - malformed / ≤0 / non-integer ⇒ the default for that field, reported via
 *   `onReject` (the module logs one loud warn naming the var + value).
 *
 * A typo can therefore never open an unlimited budget, never trip the global
 * breaker to 0, and never crash api boot. With every var unset the result is
 * byte-identical to the defaults — a fresh object the caller may not leak into
 * the shared default.
 */
export function resolveSmsBudgetThresholds(
  env: SmsBudgetEnv,
  onReject: (rejection: SmsBudgetOverrideRejection) => void = () => {},
): SmsBudgetThresholds {
  const resolved: SmsBudgetThresholds = { ...DEFAULT_SMS_BUDGET_THRESHOLDS };
  for (const field of Object.keys(
    SMS_BUDGET_ENV_VARS,
  ) as (keyof SmsBudgetThresholds)[]) {
    const envVar = SMS_BUDGET_ENV_VARS[field];
    const rawValue = env[envVar];
    if (rawValue === undefined || rawValue.trim() === "") continue; // unset ⇒ default
    const parsed = Number(rawValue);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      onReject({ envVar, rawValue }); // malformed / ≤0 / non-integer ⇒ default
      continue;
    }
    resolved[field] = parsed;
  }
  return resolved;
}

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

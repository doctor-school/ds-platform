/**
 * Login bot-challenge policy contract (EARS-17, design §10.1).
 *
 * EARS-17 lists three abuse-prone surfaces that require a bot-protection token:
 * registration, password reset, and **login after N failures**. The first two
 * are statically `@BotProtected`; login is conditional — a normal first login
 * must not burden the user with a captcha, but once an origin has failed N times
 * it is treated as the same abuse-prone surface. This policy owns the "after N"
 * decision; the verification itself reuses the same `BotProtection` provider.
 */

/** Monotonic-enough wall clock (ms). Injected so the failure window is testable. */
export type Clock = () => number;

/**
 * The challenge policy: after `threshold` failed logins from one origin within
 * `windowMs`, that origin must solve a bot-protection challenge on its next
 * login attempt. Set below the EARS-13 per-user hard limit (5/15 min) so the
 * softer captcha gate engages *before* the request is throttled outright.
 */
export interface LoginChallengeConfig {
  threshold: number;
  windowMs: number;
}

/** EARS-17 default: challenge after 3 failures within 15 minutes. */
export const DEFAULT_LOGIN_CHALLENGE_CONFIG: LoginChallengeConfig = {
  threshold: 3,
  windowMs: 15 * 60 * 1000,
};

/** DI token for {@link LoginChallengeConfig} (deployment/test-overridable). */
export const LOGIN_CHALLENGE_CONFIG = Symbol("LOGIN_CHALLENGE_CONFIG");

/** DI token for the {@link Clock} (defaults to `Date.now`; a fake in tests). */
export const LOGIN_CHALLENGE_CLOCK = Symbol("LOGIN_CHALLENGE_CLOCK");

/** Nest metadata key the `@LoginChallenged` decorator writes and the guard reads. */
export const LOGIN_CHALLENGED_KEY = "ds:login-challenged";

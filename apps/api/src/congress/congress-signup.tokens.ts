import type { CongressSignUpEnv } from "./congress-signup.config.js";

/**
 * 044 EARS-28 — the clock the intake decides the registration window from.
 *
 * A DI token rather than `new Date()` inside the service: the window's
 * boundaries are months away from any day a test runs, so before / inside /
 * after are only reachable through an injected instant. Production binds the
 * real wall clock in {@link CongressModule}.
 */
export const CONGRESS_SIGN_UP_CLOCK = Symbol("CONGRESS_SIGN_UP_CLOCK");
export type CongressSignUpClock = () => Date;

/**
 * 044 EARS-5 / EARS-9 — a READER of the two configured settings, not the values.
 *
 * A function, so configuration is resolved per request: an operator who fixes a
 * missing `CONGRESS_SIGNUP_EVENT_ID` does not have to wait for the next deploy
 * to have the intake accept submissions, and a test can prove the fail-closed
 * branch without booting a second application.
 */
export const CONGRESS_SIGN_UP_ENV = Symbol("CONGRESS_SIGN_UP_ENV");
export type CongressSignUpEnvReader = () => CongressSignUpEnv;

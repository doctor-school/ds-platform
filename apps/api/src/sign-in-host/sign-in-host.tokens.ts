/** The resolved {@link SignInHostSettings}, or `null` when the module is disabled. */
export const SIGN_IN_HOST_SETTINGS = Symbol("SIGN_IN_HOST_SETTINGS");

/** The at-rest key of the record (a throw-away key while the module is disabled). */
export const SIGN_IN_HOST_RECORD_KEY = Symbol("SIGN_IN_HOST_RECORD_KEY");

/** Wall clock, rebound in the e2e to cross the idle / lifetime boundaries. */
export const SIGN_IN_HOST_CLOCK = Symbol("SIGN_IN_HOST_CLOCK");
export type SignInHostClock = () => Date;

/** The queue's clock — submission, expiry and erasure times (tests pin it). */
export const APPLICATIONS_CLOCK = Symbol("APPLICATIONS_CLOCK");
export type ApplicationsClock = () => Date;

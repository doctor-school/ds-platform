import { z } from "zod";

/**
 * 044 EARS-1 — the ONE success body the public congress intake ever returns.
 *
 * Strict and deliberately contentless. The intake is unauthenticated, so
 * anything it echoes back is readable by anyone who can post to it: a user
 * identifier, a registration identifier or even an "account created" flag would
 * turn the endpoint into an oracle that answers «is this address already known
 * to the platform?». `status: "accepted"` says only that the submission was
 * taken.
 *
 * The shape is also PATH-INDEPENDENT on purpose. Slice 3 (#2299–#2301) adds the
 * existing-account branch, and that branch must be able to return the
 * byte-identical body — hence no discriminator and no optional member that a
 * caller could use to tell the two branches apart.
 */
export const CongressSignUpAcceptedSchema = z.strictObject({
  status: z.literal("accepted"),
});
export type CongressSignUpAccepted = z.infer<typeof CongressSignUpAcceptedSchema>;

/** 044 EARS-28 — the two states the registration window can refuse in. */
export const CONGRESS_SIGN_UP_WINDOW_REFUSAL_CODES = [
  "not-yet-open",
  "closed",
] as const;
export type CongressSignUpWindowRefusalCode =
  (typeof CONGRESS_SIGN_UP_WINDOW_REFUSAL_CODES)[number];

/**
 * 044 EARS-28 — the machine-readable refusal the intake returns when the
 * submission falls outside the registration window.
 *
 * A discriminated union rather than one object with an optional `opensAt`,
 * because the two variants carry genuinely different information and the
 * difference is load-bearing for the congress site: `not-yet-open` MUST carry
 * the opening instant so the page can render a countdown or a date, while
 * `closed` has no forward-looking instant to give and must not invent one.
 * Modelling it as a union makes «closed with an opening instant» and
 * «not-yet-open without one» unrepresentable rather than merely discouraged.
 *
 * The refusal is identical for every submitter — it is decided from the clock
 * alone, before the account lookup and before any write — so it leaks nothing
 * about whether the address is known to the platform.
 */
export const CongressSignUpWindowRefusalSchema = z.discriminatedUnion("code", [
  z.strictObject({
    code: z.literal("not-yet-open"),
    message: z.string().min(1),
    /** The instant the registration window opens, with its offset. */
    opensAt: z.iso.datetime({ offset: true }),
  }),
  z.strictObject({
    code: z.literal("closed"),
    message: z.string().min(1),
  }),
]);
export type CongressSignUpWindowRefusal = z.infer<
  typeof CongressSignUpWindowRefusalSchema
>;

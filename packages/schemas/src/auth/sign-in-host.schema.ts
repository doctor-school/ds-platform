import { z } from "zod";
import {
  LoginRequestSchema,
  OtpRequestSchema,
  OtpVerifySchema,
  PasswordResetCompleteRequestSchema,
  PasswordResetRequestSchema,
  RegisterRequestSchema,
  VerifyRequestSchema,
} from "./auth.schema.js";
import {
  DoctorRegisterRequestSchema,
  DoctorVerifyRequestSchema,
} from "../storefront/doctor-register.schema.js";

/**
 * 003 EARS-5 (amended) / 60 / 64 / 66 / 67 / 68 / 69 / 70 / 71, ADR-0015 §4 — the
 * contract between the sign-in host (`login.doctor.school`) and the API.
 *
 * The host reaches these routes through its own same-origin `/v1` rewrite, so
 * every cookie the API sets here (`__Host-ds_login`, the form-state cookie)
 * lands host-only on the sign-in host. The host forwards the browser's
 * `cookie`, `user-agent`, `accept-language`, `origin` and `x-forwarded-for`
 * untouched, exactly as the storefront BFF rewrites do.
 */

/** A Zitadel v2 auth request id as it arrives in `?authRequest=` (opaque, URL-safe). */
export const SignInHostAuthRequestIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/);

/** The storefront whose host-config the sign-in host renders (fixed per-env client map). */
export const SignInHostStorefrontSchema = z.enum(["academy", "doctor"]);
export type SignInHostStorefront = z.infer<typeof SignInHostStorefrontSchema>;

/** The door the form opens on: `/login`, `/register` (`prompt=create`) or `/reset`. */
export const SignInHostDoorSchema = z.enum(["login", "register", "reset"]);
export type SignInHostDoor = z.infer<typeof SignInHostDoorSchema>;

/**
 * EARS-71 — what a resolved entry intent tells the form. `handoff` only says a
 * Congress hand-off reference rides the intent; the reference itself never
 * leaves the API (it is redeemed server-side).
 */
export const SignInHostIntentSchema = z.strictObject({
  method: z.enum(["password", "code"]).optional(),
  eventTarget: z.string().min(1).optional(),
  handoff: z.boolean(),
});
export type SignInHostIntent = z.infer<typeof SignInHostIntentSchema>;

/**
 * `GET /v1/sign-in-host/entry?authRequest=<id>` — what the host does with a
 * navigation: render the originating storefront's form (with the form-post
 * `csrf` token bound to the form-state cookie set on this response), or
 * navigate to `url` (the Zitadel callback after a finalisation, or a storefront
 * `/login` for a stale / unknown / direct visit).
 */
export const SignInHostEntryResponseSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("render"),
    storefront: SignInHostStorefrontSchema,
    door: SignInHostDoorSchema,
    authRequest: SignInHostAuthRequestIdSchema,
    csrf: z.string().min(1),
    intent: SignInHostIntentSchema.optional(),
  }),
  z.strictObject({
    action: z.literal("redirect"),
    url: z.url(),
  }),
]);
export type SignInHostEntryResponse = z.infer<
  typeof SignInHostEntryResponseSchema
>;

export const SignInHostEntryQuerySchema = z.object({
  authRequest: z.string().optional(),
});
export type SignInHostEntryQuery = z.infer<typeof SignInHostEntryQuerySchema>;

/**
 * Every form post names the auth request it answers and carries the CSRF token
 * the entry handed out (ADR-0015 §4 req. 3); both are checked against the
 * server-side form state the form-state cookie keys.
 */
const FormPostFields = {
  authRequest: SignInHostAuthRequestIdSchema,
  csrf: z.string().min(1),
};

export const SignInHostPasswordRequestSchema =
  LoginRequestSchema.extend(FormPostFields);
export type SignInHostPasswordRequest = z.infer<
  typeof SignInHostPasswordRequestSchema
>;

export const SignInHostOtpRequestSchema =
  OtpRequestSchema.extend(FormPostFields);
export type SignInHostOtpRequest = z.infer<typeof SignInHostOtpRequestSchema>;

export const SignInHostOtpVerifySchema = OtpVerifySchema.extend(FormPostFields);
export type SignInHostOtpVerify = z.infer<typeof SignInHostOtpVerifySchema>;

export const SignInHostVerifyRequestSchema =
  VerifyRequestSchema.extend(FormPostFields);
export type SignInHostVerifyRequest = z.infer<
  typeof SignInHostVerifyRequestSchema
>;

/**
 * EARS-24 (amended) — the registration door on the sign-in host, one per
 * originating storefront: each is that storefront's own register / verify body
 * (its field set, consents and their version) plus the form-post fields, and
 * the API refuses a body whose route does not match the storefront the form
 * state recorded (the `client_id` chose it, never the browser).
 */
export const SignInHostRegisterRequestSchema =
  RegisterRequestSchema.extend(FormPostFields);
export type SignInHostRegisterRequest = z.infer<
  typeof SignInHostRegisterRequestSchema
>;

export const SignInHostDoctorRegisterRequestSchema =
  DoctorRegisterRequestSchema.extend(FormPostFields);
export type SignInHostDoctorRegisterRequest = z.infer<
  typeof SignInHostDoctorRegisterRequestSchema
>;

export const SignInHostDoctorVerifyRequestSchema =
  DoctorVerifyRequestSchema.extend(FormPostFields);
export type SignInHostDoctorVerifyRequest = z.infer<
  typeof SignInHostDoctorVerifyRequestSchema
>;

export const SignInHostPasswordResetRequestSchema =
  PasswordResetRequestSchema.extend(FormPostFields);
export type SignInHostPasswordResetRequest = z.infer<
  typeof SignInHostPasswordResetRequestSchema
>;

export const SignInHostPasswordResetCompleteRequestSchema =
  PasswordResetCompleteRequestSchema.extend(FormPostFields);
export type SignInHostPasswordResetCompleteRequest = z.infer<
  typeof SignInHostPasswordResetCompleteRequestSchema
>;

/**
 * EARS-5 (amended) — a credential step that succeeded on the sign-in host: the
 * record is replaced, `__Host-ds_login` is rotated on this response, the auth
 * request is finalised, and the host navigates to `url` (the Zitadel callback,
 * or the recorded storefront's `/login` when the auth request went stale while
 * the person typed). No storefront session exists at this point.
 */
export const SignInHostStepResponseSchema = z.strictObject({
  status: z.literal("redirect"),
  url: z.url(),
});
export type SignInHostStepResponse = z.infer<
  typeof SignInHostStepResponseSchema
>;

/**
 * EARS-44 on the sign-in host — redeem the hand-off reference the spent entry
 * intent carried. The body names no reference: the API reads it from the form
 * state the form-state cookie keys, so it never crosses the browser.
 */
export const SignInHostHandoffRequestSchema = z.object(FormPostFields);
export type SignInHostHandoffRequest = z.infer<
  typeof SignInHostHandoffRequestSchema
>;

import { z } from "zod";

import {
  ConsentAcceptanceSchema,
  EmailIdentifierSchema,
  PhoneIdentifierSchema,
  type LoginRequest,
  type OtpRequest,
  type OtpChannel,
  type PasswordResetRequest,
  type PasswordResetCompleteRequest,
  type RegisterRequest,
} from "@ds/schemas";

import {
  IdentifierFieldSchema,
  NewPasswordFieldSchema,
  OtpCodeFieldSchema,
  maskPhoneInput,
} from "@ds/design-system/fields";

/**
 * Portal-side, per-channel identifier UX validation (#192), now composed from the
 * semantic field-schema fragments that the field primitives own (#197).
 *
 * The BFF/Zitadel is the credential authority and resolves the identifier itself,
 * so `LoginRequestSchema` / `OtpRequestSchema` keep a deliberately-loose
 * `identifier` (`z.string().min(1)`) — that contract MUST NOT change. The gap this
 * closes is purely client-side UX: the login/OTP-login forms used the loose schema
 * as their RHF resolver, so a plainly-malformed identifier (a bare numeric string
 * like `99545545445` in the email channel, or non-phone text in the SMS channel)
 * sailed through to a pointless round-trip and an opaque generic failure.
 *
 * These schemas re-use the EXACT `z.email()` / `E164` shapes from `@ds/schemas`
 * (via `field-schemas.ts`, so the portal agrees with registration), but are applied
 * ONLY as the form resolver — never to the request body. The submitted body still
 * matches the loose `@ds/schemas` request schemas.
 *
 * The resolver maps these issues to localized copy by zod issue *code/shape*
 * (`lib/use-localized-resolver.ts`), so no English message text leaks.
 */

// Re-export the phone mask from the design-system package's fields entry so existing
// call sites keep importing `maskPhoneInput` from here unchanged (#197 → #235 move).
export { maskPhoneInput };

/**
 * Password login (EARS-5) — a single identifier box that accepts EITHER a valid
 * email OR an E.164 phone (Zitadel resolves whichever was typed). A bare numeric
 * string is neither, so it is rejected before submit. Composed from the shared
 * `IdentifierFieldSchema` union so the login box and the `<IdentifierField>`
 * primitive validate identically.
 */
export const LoginIdentifierFormSchema = z.object({
  identifier: IdentifierFieldSchema,
  password: z.string().min(8).max(256),
  captchaToken: z.string().optional(),
}) as unknown as z.ZodType<LoginRequest, LoginRequest>;

/**
 * Password-reset initiate (EARS-11) identifier guard (#196). Same union box as
 * password login — the reset identifier accepts EITHER a valid email OR an E.164
 * phone (Zitadel resolves it), so the bare numeric `99545545445` that #196 reported
 * is rejected before submit. Before #197 the reset form used the loose
 * `PasswordResetRequestSchema` as its resolver (no union, no guard) — that is the
 * exact defect this closes. The submitted body still matches the loose
 * `@ds/schemas` `PasswordResetRequestSchema` (identifier stays `z.string().min(1)`).
 */
export const ResetIdentifierFormSchema = z.object({
  identifier: IdentifierFieldSchema,
  captchaToken: z.string().optional(),
}) as unknown as z.ZodType<PasswordResetRequest, PasswordResetRequest>;

/**
 * OTP-login request (EARS-6 email / EARS-7 SMS) — the active channel decides which
 * shape is required: the email channel demands an email; the SMS channel demands an
 * E.164 phone. Built per active channel because the same identifier box serves both.
 * Reuses the `EmailField` / `PhoneField` shapes directly (the channel-specific case
 * of the union — the SMS box is phone-only and masked, the email box is email-only).
 */
export function otpIdentifierFormSchema(
  channel: OtpChannel,
): z.ZodType<OtpRequest, OtpRequest> {
  const identifier =
    channel === "email" ? EmailIdentifierSchema : PhoneIdentifierSchema;
  return z.object({
    identifier,
    channel: z.enum(["email", "sms"]),
    captchaToken: z.string().optional(),
  }) as unknown as z.ZodType<OtpRequest, OtpRequest>;
}

/**
 * Registration (EARS-1) portal resolver — **email-only** (#202), built from the
 * field primitives (#197/#200). Registration is email-primary: Zitadel cannot
 * create a login-capable human without an email, so the dual-identifier
 * email/phone toggle was removed (phone is a future post-registration secondary
 * identifier; it stays on login / OTP-login / reset). The password uses
 * {@link NewPasswordFieldSchema} (the message-less complexity fragment) so a weak
 * password renders the RU `passwordComplexity` copy rather than the English baked
 * into `@ds/schemas` `NewPasswordSchema` (#200 — zod v4 schema-level messages
 * outrank the localized error map).
 *
 * Why a portal-composed schema instead of `RegisterRequestSchema`: the request
 * schema's `password` is the message-carrying `NewPasswordSchema` (leaks English
 * on the field, #200), so the form resolves against this message-less composition
 * instead. The submitted body STILL goes through `authClient.register(...)` and the
 * API STILL enforces the full `RegisterRequestSchema` (email required + consent);
 * this is only the client guard. `consent`/`captchaToken` stay loose here (the form
 * supplies the canonical consent pair and the API enforces non-empty — EARS-20).
 */
export function registerFormSchema(): z.ZodType<
  RegisterRequest,
  RegisterRequest
> {
  return z.object({
    email: EmailIdentifierSchema,
    password: NewPasswordFieldSchema,
    // Deliberately NOT `.min(1)`: consent is supplied by the form (the canonical
    // `REQUIRED_CONSENT` pair on submit), never user-typed, and the API enforces the
    // non-empty gate (EARS-20) — a client length-check here would guard nothing.
    consent: z.array(ConsentAcceptanceSchema),
    captchaToken: z.string().optional(),
  }) as unknown as z.ZodType<RegisterRequest, RegisterRequest>;
}

/**
 * Password-reset COMPLETE (EARS-12) portal resolver — built from the field
 * primitives (#197/#200). The request step is already on {@link ResetIdentifierFormSchema}
 * (the union identifier box); this is the complete step, which the page previously
 * resolved with `PasswordResetCompleteRequestSchema` — the message-carrying
 * `NewPasswordSchema` inside it leaked English on a weak new password (#200). Composes
 * `newPassword` from the message-less {@link NewPasswordFieldSchema} (→ RU copy),
 * `code` from {@link OtpCodeFieldSchema}, and `identifier` from the same union box as
 * the request step. The submitted body still matches the loose `@ds/schemas`
 * `PasswordResetCompleteRequestSchema`; the API enforces the real policy.
 */
export const ResetCompleteFormSchema = z.object({
  identifier: IdentifierFieldSchema,
  code: OtpCodeFieldSchema,
  newPassword: NewPasswordFieldSchema,
}) as unknown as z.ZodType<
  PasswordResetCompleteRequest,
  PasswordResetCompleteRequest
>;

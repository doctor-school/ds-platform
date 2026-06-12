import { z } from "zod";

import {
  EmailIdentifierSchema,
  PhoneIdentifierSchema,
  type LoginRequest,
  type OtpRequest,
  type OtpChannel,
  type PasswordResetRequest,
} from "@ds/schemas";

import { IdentifierFieldSchema } from "@/components/fields/field-schemas";

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

// Re-export the phone mask from its primitive-co-located home so existing call
// sites keep importing `maskPhoneInput` from here unchanged (#197 refactor).
export { maskPhoneInput } from "@/components/fields/phone-mask";

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

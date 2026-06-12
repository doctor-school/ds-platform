import { z } from "zod";

import {
  EmailIdentifierSchema,
  PhoneIdentifierSchema,
  type LoginRequest,
  type OtpRequest,
  type OtpChannel,
} from "@ds/schemas";

/**
 * Portal-side, per-channel identifier UX validation (#192).
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
 * (so the portal agrees with registration), but are applied ONLY as the form
 * resolver — never to the request body. The submitted body still matches the loose
 * `@ds/schemas` request schemas.
 *
 * The resolver maps these issues to localized copy by zod issue *code/shape*
 * (`lib/use-localized-resolver.ts`), so no English message text leaks.
 */

/**
 * Password login (EARS-5) — a single identifier box that accepts EITHER a valid
 * email OR an E.164 phone (Zitadel resolves whichever was typed). A bare numeric
 * string is neither, so it is rejected before submit. The union surfaces a single
 * `invalid_format` issue with `format: "email"` for the field so the localized
 * resolver renders the same "email or phone" guidance.
 */
export const LoginIdentifierFormSchema = z.object({
  identifier: z.union([EmailIdentifierSchema, PhoneIdentifierSchema], {
    error: "enter a valid email address or phone number",
  }),
  password: z.string().min(8).max(256),
  captchaToken: z.string().optional(),
}) as unknown as z.ZodType<LoginRequest, LoginRequest>;

/**
 * OTP-login request (EARS-6 email / EARS-7 SMS) — the active channel decides which
 * shape is required: the email channel demands an email; the SMS channel demands an
 * E.164 phone. Built per active channel because the same identifier box serves both.
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
 * Phone input mask (#192): coerce free-typing into an E.164-valid `+<digits>`
 * string as the user types, so the stored form value is always submit-shaped (no
 * spaces — `E164` forbids them) and the SMS channel can only ever hold a phone.
 *
 *  - Empty stays empty (lets the required/format error fire, not a stray `+`).
 *  - A leading `8` (the common RU domestic prefix) and a leading bare `7` are both
 *    rewritten to the `+7` country code, so `89991234567` / `79991234567` →
 *    `+79991234567`.
 *  - Any other input is normalised to `+` followed by its digits, capped at the
 *    E.164 maximum of 15 digits.
 *
 * Display grouping (spaces) is intentionally NOT applied to the stored value; the
 * placeholder (`+7…`) communicates the expected shape without desyncing the value
 * from what the BFF receives.
 */
export function maskPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits === "" && !raw.startsWith("+")) return "";

  let normalized = digits;
  // RU domestic `8…` → `7…`; a bare leading `7` is already the country code.
  if (normalized.startsWith("8")) {
    normalized = `7${normalized.slice(1)}`;
  }
  return `+${normalized.slice(0, 15)}`;
}

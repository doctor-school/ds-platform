import { z } from "zod";

import {
  EmailIdentifierSchema,
  NewPasswordSchema,
  PhoneIdentifierSchema,
} from "@ds/schemas";

/**
 * Per-field RHF resolver fragments, co-located with the semantic field primitives
 * (#197). Each primitive owns the zod shape for the value it edits, so a form
 * composes its resolver out of the primitives it renders rather than hand-picking a
 * loose schema per call site (the #192/#196 failure mode).
 *
 * IMPORTANT — these are the *client RHF resolver* only, never the submitted body.
 * The `@ds/schemas` REQUEST schemas (LoginRequestSchema / OtpRequestSchema /
 * PasswordResetRequestSchema…) keep their deliberately-loose `identifier`
 * (`z.string().min(1)`) because the BFF/Zitadel is the credential authority and
 * resolves the identifier itself (003 design §2). This file reuses the EXACT
 * `z.email()` / `E164` shapes from `@ds/schemas` so the portal agrees with the
 * server, but applies them only as the form guard, exactly as the prior
 * `lib/identifier-validation.ts` did. The localized resolver
 * (`lib/use-localized-resolver.ts`) maps these issues to RU copy by code/shape.
 */

/** Email field shape — the `z.email()` SSOT (EARS-22 email-shape rule). */
export const EmailFieldSchema = EmailIdentifierSchema;

/** Phone field shape — the `E164` SSOT (EARS-22 E.164 rule; mask is in the UI). */
export const PhoneFieldSchema = PhoneIdentifierSchema;

/**
 * Identifier (union) field shape — accepts EITHER a valid email OR an E.164 phone
 * (#192). This is the login-password / reset identifier box: the user types one
 * credential and Zitadel resolves whichever it is, so a bare numeric string (the
 * #192/#196 bug) is neither and is rejected before submit. The union surfaces a
 * single `invalid_union` issue the localized resolver renders as the "email or
 * phone" guidance.
 */
export const IdentifierFieldSchema = z.union(
  [EmailIdentifierSchema, PhoneIdentifierSchema],
  { error: "enter a valid email address or phone number" },
);

/**
 * OTP code field shape. The BFF contract for the code is loose (`z.string().min(1)`
 * — Zitadel verifies it), so the client guard is intentionally light: a non-empty
 * value. The fixed length + numeric-only + auto-submit behavior is enforced by the
 * `<OtpField>` widget (maxLength + digit strip), not re-encoded here, mirroring the
 * server's loose `code`. Kept as a fragment so a form can compose it uniformly.
 */
export const OtpCodeFieldSchema = z.string().min(1);

/**
 * Creation-password field shape — registration / reset "new password". This is the
 * EXACT `@ds/schemas` `NewPasswordSchema` baseline (#147: min 8, ≤256, and the
 * upper/lower/digit/symbol complexity), re-exported rather than re-declared (#197):
 * `@ds/schemas` now exports the per-field fragment, so the portal composes from the
 * SSOT and the complexity regex can no longer drift out of lockstep with the BFF.
 * Zitadel remains the ultimate authority; this is only the pre-submit client guard.
 */
export const NewPasswordFieldSchema = NewPasswordSchema;

/**
 * Login (current) password field shape — deliberately permissive (#147): min 8,
 * ≤256, NO complexity, so a legacy credential predating the policy still passes the
 * client guard and Zitadel authenticates it. The `autoComplete` distinguishes
 * `current-password` (login) from `new-password` (creation) at the widget level.
 */
export const CurrentPasswordFieldSchema = z.string().min(8).max(256);

import { z } from "zod";

import {
  ConsentAcceptanceSchema,
  DOCTOR_REGISTER_FIELD_SPECS,
  EmailIdentifierSchema,
  PhoneIdentifierSchema,
  type LoginRequest,
  type OtpChannel,
  type OtpRequest,
  type RegisterRequest,
} from "@ds/schemas";
import type { RegisterCardValues } from "@ds/design-system/blocks";
import {
  IdentifierFieldSchema,
  NewPasswordFieldSchema,
  maskPhoneInput,
} from "@ds/design-system/fields";

import { resolveAuthFlowCopy } from "../copy";
import {
  AUTH_FLOW_CHANNELS,
  type AuthFlowFieldName,
  type AuthFlowHostConfig,
} from "../host-config";

/**
 * The ONE field-rule set both storefronts resolve their auth forms with (#2027,
 * gate rows 9 and 21).
 *
 * The BFF/Zitadel is the credential authority and resolves the identifier
 * itself, so the `@ds/schemas` REQUEST schemas keep a deliberately loose
 * `identifier` (`z.string().min(1)`) — that contract MUST NOT change. Everything
 * here is the client-side FORM resolver only: it stops a plainly malformed value
 * (a bare numeric string such as `99545545445`) from buying a pointless round
 * trip and an opaque generic failure. The submitted body still matches the loose
 * request schema.
 *
 * What is host DATA and what is package RULE: the shapes, the bounds, the
 * masking and the served CHANNELS (`AUTH_FLOW_CHANNELS`, #2443 — e-mail and SMS
 * on every storefront) are the rule and live here once; whether a registration
 * form carries the promo box (`config.register.promoField`) is data, and so is
 * every sentence (the package copy defaults).
 */

// The phone mask is a field-primitive concern; re-exported so an auth surface
// mounts ONE import rather than reaching past this unit into the design system.
export { maskPhoneInput };

/**
 * The identifier box of every auth door (row 21): the email-OR-E.164 union,
 * because the package serves sign-in codes over both channels (Zitadel resolves
 * whichever was typed).
 */
export function identifierFieldSchema(): z.ZodType<string, string> {
  return IdentifierFieldSchema as unknown as z.ZodType<string, string>;
}

/** 003 EARS-5 password sign-in — one identifier box plus the length-only password rule. */
export function loginIdentifierFormSchema(): z.ZodType<
  LoginRequest,
  LoginRequest
> {
  return z.object({
    identifier: identifierFieldSchema(),
    password: z.string().min(8).max(256),
    captchaToken: z.string().optional(),
  }) as unknown as z.ZodType<LoginRequest, LoginRequest>;
}

/**
 * 003 EARS-6 (email) / EARS-7 (SMS) OTP request — the ACTIVE channel decides the
 * shape, because the one identifier box serves both: the email channel demands
 * an email, the SMS channel an E.164 phone. Narrower than
 * {@link identifierFieldSchema} on purpose — here the channel is already chosen.
 */
export function otpIdentifierFormSchema(
  channel: OtpChannel,
): z.ZodType<OtpRequest, OtpRequest> {
  const identifier =
    channel === "email" ? EmailIdentifierSchema : PhoneIdentifierSchema;
  return z.object({
    identifier,
    // Row 21, enforced once: only a channel the package serves can be built.
    channel: z.enum(AUTH_FLOW_CHANNELS as [OtpChannel, ...OtpChannel[]]),
    captchaToken: z.string().optional(),
  }) as unknown as z.ZodType<OtpRequest, OtpRequest>;
}

/**
 * 003 EARS-1 registration — email-only (#202). Zitadel cannot create a
 * login-capable human without an email, so registration is email-primary on
 * every host; phone stays a post-registration secondary identifier. The password
 * uses the message-less {@link NewPasswordFieldSchema} so a weak password renders
 * the host's RU copy rather than the English baked into the `@ds/schemas`
 * `NewPasswordSchema` (#200 — zod v4 schema-level messages outrank the error map).
 *
 * `consent` is deliberately NOT `.min(1)`: the form supplies the canonical
 * `REQUIRED_CONSENT` pair on submit, it is never user-typed, and the api enforces
 * the non-empty gate (003 EARS-20).
 */
export function registerFormSchema(): z.ZodType<
  RegisterRequest,
  RegisterRequest
> {
  return z.object({
    email: EmailIdentifierSchema,
    password: NewPasswordFieldSchema,
    consent: z.array(ConsentAcceptanceSchema),
    captchaToken: z.string().optional(),
  }) as unknown as z.ZodType<RegisterRequest, RegisterRequest>;
}

/**
 * The same registration rules shaped for the shared `<RegisterCard>` form model
 * (#1934). The block owns the form state, so its VALUE shape — not the wire
 * `RegisterRequest` — is what the resolver must validate: `consent` is supplied
 * by the host on submit and is not a form field, so validating it here would set
 * an error on a field that does not exist and silently refuse every submit.
 *
 * The promo box is bound to its SSOT rule only on a host that renders it (row 9);
 * on a host without the field the key is carried through untouched rather than
 * validated, because a bound rule on an absent box can only ever refuse a submit
 * nobody can fix.
 */
export function registerCardFormSchema(
  config: AuthFlowHostConfig,
): z.ZodType<RegisterCardValues, RegisterCardValues> {
  return z.object({
    email: EmailIdentifierSchema,
    password: NewPasswordFieldSchema,
    promoCode: config.register.promoField
      ? DOCTOR_REGISTER_FIELD_SPECS.promoCode.rule.optional()
      : z.string().optional(),
    consents: z.record(z.string(), z.boolean()).optional(),
  }) as unknown as z.ZodType<RegisterCardValues, RegisterCardValues>;
}

/** The react-hook-form `rules` object one registration field binds. */
export interface RegisterFieldRules {
  readonly required?: string;
  readonly validate: (value: unknown) => true | string;
}

const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || value === "";

/**
 * Derives the RHF rules for one field from its `DOCTOR_REGISTER_FIELD_SPECS`
 * entry — the `@ds/schemas` SSOT that owns the rule, the mask and the hint — and
 * the sentences this host states for it. No bound is ever typed twice: a literal
 * `8` / `64` / `6` on a screen is exactly the drift this projection prevents.
 *
 * The blank case is deliberately delegated: a required field's empty box is
 * reported by `required` (one message, not two) and an optional field's empty box
 * is valid, which is why the message is the only thing this function supplies.
 *
 * A host that binds a field it states no copy for is a CONFIG defect, not a
 * runtime fallback: an invented English message would render to a doctor.
 */
export function registerFieldRules(
  config: AuthFlowHostConfig,
  name: AuthFlowFieldName,
): RegisterFieldRules {
  const spec = DOCTOR_REGISTER_FIELD_SPECS[name];
  const copy = resolveAuthFlowCopy(config).fields[name];
  if (copy === undefined) {
    throw new Error(`auth-flow: this host states no copy for field "${name}"`);
  }

  return {
    ...(copy.required === undefined ? {} : { required: copy.required }),
    validate: (value: unknown) => {
      if (isBlank(value)) {
        return true;
      }
      return spec.rule.safeParse(value).success ? true : copy.invalid;
    },
  };
}

/** The persistent pre-submit hint of a field, or `null` when it has none. */
export function registerFieldHint(name: AuthFlowFieldName): string | null {
  return DOCTOR_REGISTER_FIELD_SPECS[name].hint;
}

/**
 * Validates a typed confirmation code against the `code` FieldSpec, returning
 * this host's RU message or `null` when it passes.
 *
 * Six digits by contract (021 EARS-11, #2636): the same `VERIFY_CODE_PATTERN`
 * the BFF enforces, so a value the server would refuse is refused here first.
 */
export function resolveVerificationCode(
  config: AuthFlowHostConfig,
  value: unknown,
): string | null {
  return DOCTOR_REGISTER_FIELD_SPECS.code.rule.safeParse(value).success
    ? null
    : resolveAuthFlowCopy(config).fields.code.invalid;
}

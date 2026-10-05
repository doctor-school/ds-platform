import { z } from "zod";

import {
  ConsentAcceptanceSchema,
  NewPasswordSchema,
  VerifyRequestSchema,
} from "../auth/auth.schema.js";

/**
 * 021 EARS-4 — the medical-worker declaration consent purpose.
 *
 * A **declaration, not a verification**: the doctor states that they are a
 * medical worker, and no document is requested to support it. Content that
 * needs *confirmed* status stays gated on features 022 / 037; nothing here
 * asserts a verified status.
 *
 * The literal lives in the API-contract SSOT so the storefront form, the
 * command guard and the consent row all name the same purpose string — a copy
 * of it in an app is exactly the divergence this constant exists to prevent.
 */
export const MEDICAL_WORKER_DECLARATION_PURPOSE = "medical-worker-declaration";

/**
 * 021 EARS-5 — the mandatory partner-data consent, the SECOND access condition.
 *
 * It is an access condition and not a preference: 021 design §4 records it in
 * the same tier as the declaration, with the same "record when withheld →
 * command refused" rule. The literal lives here for the same reason the
 * declaration's does — the form, the guard and the consent row must name one
 * string.
 */
export const PARTNER_DATA_SHARING_PURPOSE = "partner-data-sharing";

/**
 * 021 EARS-6 (#1542) — the OPTIONAL marketing opt-in.
 *
 * Named here so the storefront's tier-2 control and the future record write
 * agree on one purpose string, and deliberately ABSENT from the required list
 * below: withholding it refuses nothing. Its record semantics are EARS-6's — a
 * row only when granted, no row at all when withheld — and hold by
 * construction, because an ungranted purpose is simply absent from the
 * command's `consent` array and there is no `granted: false` shape to store.
 */
export const MARKETING_COMMUNICATIONS_PURPOSE = "marketing-communications";

/**
 * 021 EARS-7 (#1543) — every purpose the registration command is willing to
 * record, as a CLOSED list.
 *
 * The 003 `ConsentAcceptanceSchema` deliberately takes any non-empty purpose
 * string: 003 is the engine and does not know which purposes a given surface
 * renders. 021 does — it renders exactly three — so the storefront command
 * closes the list at its own I/O boundary. Without it a caller could name a
 * purpose no surface ever displayed and still get an append-only
 * `consent_records` row for it, which is a consent record of nothing; EARS-7
 * requires one versioned record per purpose the doctor actually granted on
 * THIS surface.
 *
 * Adding a purpose here is therefore a surface decision (new rendered wording
 * plus its server-stamped version constant), never a contract convenience.
 */
export const DOCTOR_REGISTER_CONSENT_PURPOSES = [
  MEDICAL_WORKER_DECLARATION_PURPOSE,
  PARTNER_DATA_SHARING_PURPOSE,
  MARKETING_COMMUNICATIONS_PURPOSE,
] as const;
export type DoctorRegisterConsentPurpose =
  (typeof DOCTOR_REGISTER_CONSENT_PURPOSES)[number];

/**
 * Is this purpose one the 021 registration surface actually renders?
 *
 * Exported as a guard rather than kept private, because the same closed list is
 * restated in the service as a DOMAIN rule (a caller reaching the service
 * without the DTO pipe must meet it too) and the two must not drift.
 */
export function isDoctorRegisterConsentPurpose(
  purpose: string,
): purpose is DoctorRegisterConsentPurpose {
  return (DOCTOR_REGISTER_CONSENT_PURPOSES as readonly string[]).includes(
    purpose,
  );
}

/**
 * One granted consent inside a 021 registration command: the 003 acceptance
 * shape whose purpose must be one this surface renders.
 *
 * Derived from `ConsentAcceptanceSchema` rather than restated, so the two never
 * drift on the `version` rule; 003's own schema stays untouched for every other
 * caller of the engine.
 *
 * The check is a refinement over `string` rather than a `z.enum` literal union
 * on purpose. Both refuse an undeclared purpose identically at run time; the
 * enum would additionally narrow the INFERRED request type, and the doctor
 * storefront that builds this array is frozen for the wave-1 extraction into
 * `packages/auth-flow` (#2027 / epic #2020), which forbids touching it. The
 * narrowing is worth having and is recorded as debt for that extraction — it is
 * a type-level improvement, not the rule itself, which lives here and in the
 * service.
 */
export const DoctorRegisterConsentAcceptanceSchema =
  ConsentAcceptanceSchema.extend({
    purpose: z
      .string()
      .min(1)
      // The callback is annotated `: boolean` deliberately: passing the type
      // guard directly would make zod narrow the INFERRED purpose to the
      // literal union, and the frozen storefront (#2027) still declares its
      // array as the wide 003 `ConsentAcceptance`. The refusal is identical
      // either way — this is about the inferred type, not the rule.
      .refine((purpose): boolean => isDoctorRegisterConsentPurpose(purpose), {
        message: `purpose must be one of: ${DOCTOR_REGISTER_CONSENT_PURPOSES.join(", ")}`,
      }),
  });
export type DoctorRegisterConsentAcceptance = z.infer<
  typeof DoctorRegisterConsentAcceptanceSchema
>;

/**
 * Purposes the 021 registration command refuses to proceed without (021 design
 * §4: "Record when withheld → **command refused**").
 *
 * Both access conditions of the EARS-5 two-tier block: the EARS-4 declaration
 * and the partner-data consent. The list — not two single constants — is what
 * lets the guard state the rule once and refuse on whichever is missing; the
 * marketing opt-in is not here because withholding it refuses nothing.
 */
export const REQUIRED_DOCTOR_REGISTER_CONSENT_PURPOSES = [
  MEDICAL_WORKER_DECLARATION_PURPOSE,
  PARTNER_DATA_SHARING_PURPOSE,
] as const;

/**
 * Stable, client-readable code for an EARS-4 refusal.
 *
 * Deliberately SPECIFIC where the 003 register failures are generic. 003
 * EARS-16's enumeration safety is about never disclosing whether an *account*
 * exists; this refusal describes the submitted *request* only, fires identically
 * for every email — registered or not — and is raised before any IdP call, so it
 * is no existence oracle. 021 EARS-12 in turn requires a refusal to be
 * actionable in the field where it occurred, which a generic string cannot
 * support.
 */
export const MEDICAL_WORKER_DECLARATION_REQUIRED_CODE =
  "medical_worker_declaration_required";

/**
 * Stable, client-readable code for an EARS-5 refusal — the partner-data consent
 * withheld.
 *
 * A SECOND code rather than a shared «an access condition is missing» one: 021
 * EARS-12 requires a refusal to be actionable **in the field where it
 * occurred**, and the two access conditions are two different checkboxes. One
 * generic code would leave the client guessing which box to point at, and
 * widening the declaration's code to cover this purpose would make it say
 * something untrue. The enumeration-safety reasoning of the declaration code
 * applies here unchanged: it describes the submitted request, fires identically
 * for every email, and is raised before any IdP call.
 */
export const PARTNER_DATA_SHARING_REQUIRED_CODE =
  "partner_data_sharing_required";

/**
 * Which refusal code each required purpose raises. The guard reads this map
 * instead of branching, so a third access condition would be a data change
 * here and nowhere else.
 */
export const DOCTOR_REGISTER_CONSENT_REFUSAL_CODES: Readonly<
  Record<string, string>
> = {
  [MEDICAL_WORKER_DECLARATION_PURPOSE]:
    MEDICAL_WORKER_DECLARATION_REQUIRED_CODE,
  [PARTNER_DATA_SHARING_PURPOSE]: PARTNER_DATA_SHARING_REQUIRED_CODE,
};

/**
 * One consent line as the screen reads it (021 requirements — `ConsentItem`).
 *
 * `statement` is the sentence the door RENDERS for that purpose, composed from
 * the shared auth copy (`consentStatementOf` in `@ds/auth-flow/copy`) rather
 * than written a second time here: a record may only carry wording the doctor
 * actually read. The item names the exchange it is the condition of — the
 * composition of the shared data is disclosed in the policy text and by the
 * platform manager (021 EARS-5), not enumerated inside the row the doctor
 * ticks.
 */
export const ConsentItemSchema = z.strictObject({
  purpose: z.string().min(1),
  required: z.boolean(),
  statement: z.string().min(1),
});
export type ConsentItem = z.infer<typeof ConsentItemSchema>;

/**
 * One rendered tier of the F-021-1 «вариант Б» block (021 requirements —
 * `ConsentTier`). Exactly two tiers exist: the access conditions framed above
 * the submit, and the optional marketing opt-in standing below it.
 */
export const ConsentTierSchema = z.strictObject({
  tier: z.enum(["access-conditions", "marketing"]),
  items: z.array(ConsentItemSchema).min(1),
});
export type ConsentTier = z.infer<typeof ConsentTierSchema>;

/**
 * `RegisterDoctor` — the 021 registration command (021 design §2).
 *
 * 021 owns a surface; 003 owns the engine. This payload is the whole seam: it
 * carries the storefront-shaped input and the granted consent purposes, and the
 * command hands credential creation to the 003 registration path unchanged. It
 * defines **no second credential path, no second code path and no second
 * consent model** — the fields below are the storefront's additions to that one
 * engine, never a replacement for it.
 *
 * `medicalWorkerDeclaration` is `z.literal(true)`, not `z.boolean()`: the
 * declaration is a PRECONDITION of the command, so a payload that carries
 * `false` is not a valid command that later fails a rule — it is not a
 * `RegisterDoctor` at all. The flag and the consent array agree by construction
 * (the service derives the purpose row from the flag), which is why the array
 * does not have to be trusted to carry it.
 */
export const DoctorRegisterRequestSchema = z.object({
  email: z.email(),
  password: NewPasswordSchema,
  /**
   * 021 EARS-4. Literal `true`: the mandatory declaration has no "ask later"
   * form, no partial variant and no path that completes registration without
   * it.
   */
  medicalWorkerDeclaration: z.literal(true),
  /**
   * Additional granted purposes beyond the declaration — the mandatory
   * partner-data consent (EARS-5, #1541) and the optional marketing opt-in
   * (EARS-6, #1542) land here. An ungranted optional purpose is ABSENT from
   * this array; there is no `granted: false` shape, because EARS-7 requires an
   * ungranted purpose to produce no record at all.
   */
  consent: z.array(DoctorRegisterConsentAcceptanceSchema).default([]),
  /**
   * 003 EARS-17 bot-protection widget token (021 EARS-19, #1558). Optional at
   * the contract layer exactly as the 003 register payload has it — the guard
   * no-ops when the provider is disabled (the dev-stand default). 021 declares
   * no threshold, provider or challenge logic of its own.
   */
  captchaToken: z.string().optional(),
});
export type DoctorRegisterRequest = z.infer<typeof DoctorRegisterRequestSchema>;

/**
 * Response. Identical for the never-registered and the already-registered email
 * (003 EARS-16 / 021 EARS-13) — body, status and shape disclose nothing about
 * account existence, and the doctor is routed to the same existence-agnostic
 * verification state either way.
 */
export const DoctorRegisterResponseSchema = z.strictObject({
  status: z.literal("pending_verification"),
});
export type DoctorRegisterResponse = z.infer<
  typeof DoctorRegisterResponseSchema
>;

/**
 * 003 EARS-23/41 on the doctor storefront — the in-tab registration values the
 * one code step carries to `POST /v1/storefront/doctor/verify`. The same
 * fields, with the same rules, as {@link DoctorRegisterRequestSchema}: the
 * declaration is a literal `true`, presence of a purpose in `consent` is its
 * grant, and every version is stamped by the server — the one this door's
 * register stamps — so a client-sent version is never recorded.
 */
export const DoctorVerifyRegistrationSchema = z.object({
  password: NewPasswordSchema,
  medicalWorkerDeclaration: z.literal(true),
  consent: z.array(DoctorRegisterConsentAcceptanceSchema).default([]),
});
export type DoctorVerifyRegistration = z.infer<
  typeof DoctorVerifyRegistrationSchema
>;

/**
 * The doctor host's code-step request: the 003 verify request whose optional
 * `registration` is this door's own. The response is the 003
 * `VerifyResponse`, and the session cookie is set exactly as on 003 `/verify`.
 */
export const DoctorVerifyRequestSchema = VerifyRequestSchema.extend({
  registration: DoctorVerifyRegistrationSchema.optional(),
});
export type DoctorVerifyRequest = z.infer<typeof DoctorVerifyRequestSchema>;

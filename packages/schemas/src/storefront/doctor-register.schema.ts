import { z } from "zod";

import {
  ConsentAcceptanceSchema,
  NewPasswordSchema,
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
 * below: its record semantics (a row only when granted, no row at all when
 * withheld) are #1542's to land.
 */
export const MARKETING_COMMUNICATIONS_PURPOSE = "marketing-communications";

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
 * 021 EARS-5 / design §4 — the EXACT composition of the data shared with
 * partners, and what is excluded from it.
 *
 * These arrays are the source of the statement the doctor reads, not a
 * documentation echo of a sentence written elsewhere: design §4 requires the
 * statement to be "data-driven, not a copy blob", so that changing the shared
 * composition changes the rendered statement and the recorded purpose together
 * rather than leaving a stale sentence on the door. A hardcoded Russian
 * sentence in `apps/doctor` is exactly the divergence this pair prevents.
 */
export const PARTNER_DATA_COMPOSITION = [
  "ФИО",
  "специальность",
  "город",
  "место работы",
] as const;

export const PARTNER_DATA_EXCLUDED = ["контакты"] as const;

/**
 * Render the partner-data statement FROM the composition — the canvas sentence
 * of `design-source/auth.dc.html` (`#d-register`, вариант Б), assembled rather
 * than transcribed.
 *
 * The canvas draws: «Согласен на передачу партнёрам платформы данных: ФИО,
 * специальность, город, место работы. Контакты не передаются.» Only the frame
 * of that sentence is copy; the two lists inside it are data.
 */
export function formatPartnerDataStatement(
  composition: readonly string[] = PARTNER_DATA_COMPOSITION,
  excluded: readonly string[] = PARTNER_DATA_EXCLUDED,
): string {
  const shared = composition.join(", ");
  const withheld = excluded.join(", ");
  const capitalised = withheld.charAt(0).toUpperCase() + withheld.slice(1);
  return `Согласен на передачу партнёрам платформы данных: ${shared}. ${capitalised} не передаются.`;
}

/**
 * One consent line as the screen reads it (021 requirements — `ConsentItem`).
 *
 * `statement` is what the doctor reads; `dataComposition` / `excluded` are what
 * it was built from, carried alongside so the surface can render the lists
 * structurally (and a test can assert them) without re-splitting a sentence.
 */
export const ConsentItemSchema = z.strictObject({
  purpose: z.string().min(1),
  required: z.boolean(),
  statement: z.string().min(1),
  dataComposition: z.array(z.string().min(1)).optional(),
  excluded: z.array(z.string().min(1)).optional(),
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
  consent: z.array(ConsentAcceptanceSchema).default([]),
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

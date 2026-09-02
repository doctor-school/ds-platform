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
 * Purposes the 021 registration command refuses to proceed without (021 design
 * §4: "Record when withheld → **command refused**").
 *
 * Release 1 carries the EARS-4 declaration alone. The `partner-data-sharing`
 * access condition joins it with the two-tier consent block (EARS-5, #1541) —
 * which is why this is a LIST with one entry rather than a single constant: the
 * guard below is already shaped for the second purpose, so adding it is a data
 * change and not a rewrite of the refusal path.
 */
export const REQUIRED_DOCTOR_REGISTER_CONSENT_PURPOSES = [
  MEDICAL_WORKER_DECLARATION_PURPOSE,
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

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
 * `ConfirmEmail` — the 021 confirmation command (021 design §2, EARS-10).
 *
 * The second and last box of the 021 seam. It carries the 003 verification
 * payload unchanged (`email` + `code`, verified by the 003 engine and by
 * nothing here) plus the ONE thing 021 adds: the return target the doctor
 * carried in.
 *
 * ## Why the target travels in the REQUEST and not in the email
 *
 * 003 EARS-29 verification emails are code-only and LINK-FREE by decision
 * (#910/#1045: zero anchor elements and zero URLs), so there is no confirmation
 * URL for a return target to ride in. The target is carried IN-APP instead — in
 * the query of the doctor host's sent-state / code-entry URL, exactly as the
 * portal already does it (apps/portal/lib/registration-handoff.ts
 * `withReturnTarget`) — and handed back here, where it is re-validated
 * server-side by the shipped guard. Moving a link into a 003 email would be a
 * 003 increment, never a 021 requirement (021-design §2).
 */
export const DoctorConfirmRequestSchema = z
  .object({
    email: z.email(),
    /**
     * The IdP-issued verification code, forwarded verbatim to 003.
     * Normalization (trim + uppercase, #1109) belongs to the engine, so this
     * contract states no length, alphabet or case rule of its own — a second
     * code vocabulary here would be the forked code path LD-1 forbids.
     */
    code: z.string(),
    /**
     * The carried return target, RAW as the client held it. Deliberately a
     * plain string rather than the guard-refined form: a hostile or undeclared
     * value is treated as ABSENT (the doctor lands on the LD-4 default), never
     * as a 400. A confirmation that succeeds at the IdP must not be turned into
     * a failure by a query parameter the doctor never typed — and rejecting the
     * payload would hand an attacker a probe for what the whitelist admits. The
     * guard runs in the service; its verdict shapes the landing, not the status.
     */
    returnTo: z.string().optional(),
  })
  .strict();
export type DoctorConfirmRequest = z.infer<typeof DoctorConfirmRequestSchema>;

/**
 * LD-8 — why the carried target was NOT the destination. Present only on a
 * `landing` action, and only when a target was actually carried and found
 * stale: it is what lets the surface state in plain Russian what happened to
 * what the doctor came for, rather than performing the silent redirect LD-8
 * forbids.
 *
 * The four values are the four honest answers the public event read can give:
 *
 * * `ended` — the эфир is over (`ended`, or an `in_archive` legacy эфир);
 * * `full` — an offline/hybrid event whose seats ran out (`seatsLeft === 0`;
 *   `null` seats means unlimited and is NOT this case);
 * * `unpublished` — the event is `hidden`: it exists, and its direct link
 *   resolves to a public notice rather than a 404 (004 EARS-5);
 * * `missing` — the public read has no body at all. A `draft` and a
 *   non-existent id are ONE answer here on purpose: 004 EARS-6 makes them
 *   indistinguishable so a public surface cannot become an existence oracle,
 *   and a fifth value splitting them would build exactly that oracle.
 */
export const DOCTOR_CONFIRM_LANDING_REASONS = [
  "ended",
  "full",
  "unpublished",
  "missing",
] as const;
export const DoctorConfirmLandingReasonSchema = z.enum(
  DOCTOR_CONFIRM_LANDING_REASONS,
);
export type DoctorConfirmLandingReason = z.infer<
  typeof DoctorConfirmLandingReasonSchema
>;

/**
 * EARS-10's PRIMARY action — where the doctor goes next, resolved server-side.
 *
 * `kind` states which of the two EARS-10 outcomes happened, so the surface can
 * render the degraded branch without re-deriving it from the href:
 *
 * * `return` — the carried point of interest is still live, and `href` IS the
 *   guard's reconstruction of it. Never carries a `reason`.
 * * `landing` — the doctor arrived directly (no target carried), or the target
 *   went stale (LD-8), in which case `reason` says what happened.
 *
 * `href` is ALWAYS either the guard's own reconstruction or one of the closed
 * literals this contract declares — never a string assembled from the raw
 * client input (021-design §3, property 1).
 */
export const DoctorConfirmPrimaryActionSchema = z
  .object({
    kind: z.enum(["return", "landing"]),
    href: z.string(),
    /**
     * Absent on `return` and on a direct arrival; present exactly when a target
     * was carried and could not be honoured. Absent is not "no reason" on a
     * degraded branch — it is "nothing degraded".
     */
    reason: DoctorConfirmLandingReasonSchema.optional(),
  })
  .strict();
export type DoctorConfirmPrimaryAction = z.infer<
  typeof DoctorConfirmPrimaryActionSchema
>;

/**
 * The doctor host's cabinet path — EARS-10's SECONDARY action, and a TRACKED
 * front door rather than a shipped route: `apps/doctor` has no cabinet yet (it
 * lands with «Витрина R5 — Кабинет врача и школа», #1842).
 *
 * It is declared anyway because EARS-10's requirement is about RANK — «в личный
 * кабинет» exists as the secondary action and the account page is never the
 * default outcome — and that rank is a property of the response, not of whether
 * the destination is built. Omitting the action until #1842 would make release
 * 1 ship the one shape EARS-10 explicitly forbids: a success state whose only
 * action is the landing.
 */
export const DOCTOR_CABINET_PATH = "/account";

/**
 * EARS-10's SECONDARY action. A closed one-member `kind` and a closed `href`:
 * there is exactly one secondary action on this surface and it is never the
 * default, so neither field is a choice the caller or the client gets to make.
 */
export const DoctorConfirmSecondaryActionSchema = z
  .object({
    kind: z.literal("cabinet"),
    href: z.literal(DOCTOR_CABINET_PATH),
  })
  .strict();
export type DoctorConfirmSecondaryAction = z.infer<
  typeof DoctorConfirmSecondaryActionSchema
>;

/**
 * The 021 post-confirmation SUCCESS STATE (EARS-9, EARS-10) — the whole body of
 * the confirmation response.
 */
export const DoctorConfirmResponseSchema = z
  .object({
    /** The 003 verify verdict, passed through unchanged (003 EARS-3). */
    status: z.literal("verified"),
    /**
     * EARS-9 / LD-6 — the credited registration amount, as a FACT.
     *
     * `null` in release 1, and `null` is the honest answer rather than a
     * placeholder: an amount may be stated only once feature 025 has asserted it
     * with `PointsCredited` for this account, 025 has no spec and no Issues, and
     * the accrual itself is wave 2 (#1545). LD-6 forbids deriving it from
     * configuration, so there is no number the server could put here today — and
     * a `0` would be a lie rather than an absent fact. The surface names the
     * accrual as the pending promise it is.
     */
    credited: z.number().int().nonnegative().nullable(),
    /**
     * EARS-9 — the plain line naming what completing the profile adds and what
     * it unlocks, or `null` while there is nothing configured to name.
     *
     * `null` in release 1 for the same reason `credited` is: the increment comes
     * from LD-6's one configuration source, which is wave 2 (#1545). The line is
     * server-resolved rather than client-composed because its VALUE is
     * configuration; a client that invented the number would be the
     * configuration-derived stand-in LD-6 forbids.
     */
    profileCompletion: z.string().nullable(),
    /** EARS-10 — the point of interest, or the LD-4/LD-8 landing. */
    primaryAction: DoctorConfirmPrimaryActionSchema,
    /** EARS-10 — «в личный кабинет», secondary and never the default. */
    secondaryAction: DoctorConfirmSecondaryActionSchema,
  })
  .strict();
export type DoctorConfirmResponse = z.infer<typeof DoctorConfirmResponseSchema>;

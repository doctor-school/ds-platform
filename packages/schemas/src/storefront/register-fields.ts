import { z } from "zod";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../auth/index.js";

/**
 * 021 EARS-11 (#1547) — the per-field validation contract of the doctor
 * registration screen, as ONE table.
 *
 * This is the read model 021 requirements L201 declares —
 * `FieldSpec { name, rule, mask, hint, errorSlot }` — filled in from the design
 * §7 field table. The screen composes its react-hook-form rules out of this
 * table (`apps/doctor/lib/register-fields.ts`) rather than re-typing a bound
 * per call site, so «not less than 8 characters» exists once and the hint the
 * doctor reads cannot drift from the rule that rejects them.
 *
 * IMPORTANT — this is the CLIENT guard only, never the submitted body, exactly
 * as `packages/design-system/src/primitives/fields/field-schemas.ts` is for the
 * portal. The rules are message-LESS by design (#200): the RU copy belongs to
 * the host screen's catalog, and a schema-level message in zod v4 would outrank
 * it. The REQUEST schemas stay as they are — in particular
 * `DoctorConfirmRequestSchema.code` remains `z.string()` because the 003 engine
 * normalises trim + case server-side and the request contract carries no 021
 * code vocabulary (LD-1).
 */

/**
 * The input mask a field applies. 021 design §7 gives every field of this
 * screen `none`, and the union is deliberately narrow: adding a mask is a spec
 * change, not a call-site decision.
 */
export type FieldMask = "none";

/** Where a field's error is rendered. Every 021 field owns its own slot. */
export type FieldErrorSlot = "field";

/** The 021 requirements L201 read model, one entry per rendered field. */
export interface FieldSpec {
  /** The form field name — the react-hook-form path the rule binds to. */
  readonly name: string;
  /** The message-less client guard. Copy is the host screen's. */
  readonly rule: z.ZodType<string>;
  /** Input mask; `none` for every field of this screen (design §7). */
  readonly mask: FieldMask;
  /** Persistent pre-submit hint, or `null` when the field carries none. */
  readonly hint: string | null;
  /** The slot the error is routed to. */
  readonly errorSlot: FieldErrorSlot;
}

/**
 * The client-side promo-code length bound (021 design §7).
 *
 * Client-only on purpose: `promoCode` is NOT a field of
 * `DoctorRegisterRequestSchema` — the attribution command that consumes it is
 * EARS-8's (#1544). Declared once here so the screen and its tests cannot
 * disagree about the bound.
 */
export const PROMO_CODE_MAX_LENGTH = 64;

/** The fixed length of the emailed confirmation code (021 design §7). */
export const VERIFY_CODE_LENGTH = 6;

/**
 * The confirmation-code shape: fixed length, letters AND digits, matched
 * case-INSENSITIVELY.
 *
 * Case-insensitive is the whole point of LD-9: the code the doctor receives is
 * alphanumeric, the OTP widget already normalises the value to upper case, and
 * the 003 engine uppercases again server-side — so a lowercase-typed code is a
 * VALID code, and rejecting it (or transforming it with CSS, which LD-9
 * forbids outright) would be the client inventing a vocabulary the contract
 * does not have.
 */
export const VERIFY_CODE_PATTERN = new RegExp(
  `^[a-z0-9]{${VERIFY_CODE_LENGTH}}$`,
  "i",
);

/**
 * 021 EARS-11 / design §7 — the four fields of the registration flow.
 *
 * Every entry declares `mask: "none"` with the §7 reason on the spot; a mask
 * appears here only when the spec grows one.
 */
export const DOCTOR_REGISTER_FIELD_SPECS = {
  /**
   * Address shape only — an affordance, not deliverability, which only the
   * emailed code can prove. No mask: an email address has no fixed template to
   * impose, and a mask would fight paste.
   */
  email: {
    name: "email",
    rule: z.email(),
    mask: "none",
    hint: null,
    errorSlot: "field",
  },
  /**
   * Length only (003 EARS-36) — 021 declares no character-class policy. The
   * bounds are the `@ds/schemas` SSOT constants, the mirror of the provisioned
   * Zitadel policy, never re-declared here. No mask: a password is free text.
   *
   * The hint is the PRE-SUBMIT half of the one-slot hint-OR-error contract
   * (003 EARS-37, owner decision Б): the shared `FormMessage` slot shows this
   * hint until an error exists, and the error — which restates the same rule —
   * replaces it.
   */
  password: {
    name: "password",
    rule: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
    mask: "none",
    hint: `Не менее ${PASSWORD_MIN_LENGTH} символов.`,
    errorSlot: "field",
  },
  /**
   * Trim + a length bound, and nothing else: the code vocabulary belongs to a
   * campaign, not to the form (design §7). No mask for exactly that reason —
   * the client does not know the campaign's shape, so imposing one would
   * reject valid codes.
   */
  promoCode: {
    name: "promoCode",
    rule: z.string().trim().max(PROMO_CODE_MAX_LENGTH),
    mask: "none",
    hint: null,
    errorSlot: "field",
  },
  /**
   * Fixed length, alphanumeric, case-insensitive (see
   * {@link VERIFY_CODE_PATTERN}). No mask: the slotted OTP widget already
   * supplies the fixed-length affordance structurally, and a CSS uppercase
   * transform is forbidden by LD-9 — the value is normalised, never the
   * glyphs.
   */
  code: {
    name: "code",
    rule: z.string().trim().length(VERIFY_CODE_LENGTH).regex(VERIFY_CODE_PATTERN),
    mask: "none",
    hint: null,
    errorSlot: "field",
  },
} as const satisfies Record<string, FieldSpec>;

/** The field names 021 EARS-11 governs. */
export type DoctorRegisterFieldName = keyof typeof DOCTOR_REGISTER_FIELD_SPECS;

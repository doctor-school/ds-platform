import { z } from "zod";
import {
  ConfigureStreamRequestSchema,
  CreateEventRequestSchema,
  type SpeakerEntry,
} from "@ds/schemas";
import {
  CurrentPasswordFieldSchema,
  EmailFieldSchema,
} from "@ds/design-system/fields";

/**
 * Admin-form client validation schemas (#665), DERIVED from the `@ds/schemas` SSOT
 * (ADR-0002) — never a hand-duplicated second copy of the bounds. Each field reuses
 * the exact create-schema field validator (`CreateEventRequestSchema.shape.*`), so
 * the client and the api can never drift; these schemas are applied ONLY as the RHF
 * resolver (the submitted body still passes the api's Zod DTO — the server stays the
 * authority). The RU rendering of these structured issues is owned by
 * `use-localized-resolver.ts` (EARS-10); the raw schema messages stay English.
 *
 * The create schema is the source for BOTH the create and the edit form: they author
 * the same aggregate (edit only pre-fills), so a single form schema validates both.
 */
const create = CreateEventRequestSchema.shape;

/** The parsed comma list a `specialtiesText` box maps to (the SSOT array validator). */
function parseSpecialties(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The event create/edit form shape. `specialtiesText` is the operator-facing comma
 * box; it is validated by folding the parsed tokens back through the SSOT
 * `specialties` array validator (per-token length + list-count cap) so the rule is
 * the schema's, not a re-typed constant. `partnerRef` is an optional free-text box
 * ("" when empty); `programPdf` is validated separately (a File, not a JSON field).
 */
export const EventFormSchema = z.object({
  title: create.title,
  school: create.school,
  startsAtMsk: create.startsAtMsk,
  durationMin: create.durationMin,
  description: create.description,
  partnerRef: create.partnerRef,
  speakers: create.speakers,
  specialtiesText: z.string().superRefine((text, ctx) => {
    const result = create.specialties.safeParse(parseSpecialties(text));
    if (result.success) return;
    for (const issue of result.error.issues) {
      // A too_big at the ARRAY level (empty path) is the list-count cap → a `custom`
      // issue the resolver maps to "too many"; a too_big on an element (numeric path)
      // is a per-token length problem → keep the too_big code (mapped to "too long").
      // NB: no baked `message` on either issue — an explicit issue message outranks
      // the localized per-parse error map and would leak English (#200 precedent).
      if (issue.code === "too_big" && issue.path.length === 0) {
        ctx.addIssue({ code: "custom" });
      } else {
        ctx.addIssue({
          code: "too_big",
          origin: "string",
          maximum: 100,
          inclusive: true,
        });
      }
    }
  }),
});

export interface EventFormFields {
  title: string;
  school: string;
  startsAtMsk: string;
  durationMin: number;
  description: string;
  partnerRef: string;
  speakers: SpeakerEntry[];
  specialtiesText: string;
}

/** The stream-config form validator — the SSOT request schema verbatim (EARS-3). */
export const StreamConfigFormSchema = ConfigureStreamRequestSchema;

/**
 * The admin login form (007 EARS-8 surface, #665 rework — the Stage-B finding:
 * native browser bubbles instead of DS RU errors). Composed from the semantic
 * field-schema fragments the design-system field primitives own (#197 — the same
 * fragments the portal auth forms use): the email box is the `z.email()` SSOT
 * shape, the password box the permissive login guard (min 8 / ≤256, NO complexity
 * — never lock out a legacy credential client-side; #147). Applied ONLY as the RHF
 * resolver; the submitted body stays the loose `LoginRequestSchema` contract and
 * Zitadel remains the credential authority.
 */
export const LoginFormSchema = z.object({
  email: EmailFieldSchema,
  password: CurrentPasswordFieldSchema,
});

export interface LoginFormFields {
  email: string;
  password: string;
}

export interface StreamConfigFields {
  provider: (typeof ConfigureStreamRequestSchema)["_output"]["provider"];
  embedRef: string;
}

export { parseSpecialties };

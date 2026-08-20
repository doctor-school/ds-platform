import { z } from "zod";
import {
  ConfigureStreamRequestSchema,
  CreateEventRequestSchema,
  CreateExpertRequestSchema,
  CreateProjectRequestSchema,
  CreateTopicRequestSchema,
  EXPERT_AFFILIATION_MAX,
  EXPERT_BIO_MAX,
  EXPERT_CREDENTIALS_MAX,
  EXPERT_PROFESSIONAL_ROLE_MAX,
  type ProjectKind,
  SlugSchema,
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

/**
 * The 012 project create/edit form (#1283). DERIVED from the `@ds/schemas` SSOT
 * exactly as the event form is: each field reuses the create-schema validator, so
 * the bound the operator sees before submit is the bound the API enforces.
 *
 * `slug` is a plain string here rather than `SlugSchema.optional()`: the form box
 * is always present (it shows the generated preview), and an empty box means
 * "generate it server-side". So emptiness is legal and only a NON-empty value is
 * validated against the SSOT slug rules.
 *
 * `description` is required by the form even though the column is nullable: a
 * draft may legally be incomplete, but the operator authoring one is asking to
 * fill it in, and publication (#1287) will demand it anyway. Leaving it optional
 * would move the discovery of the missing field to publish time.
 */
const projectCreate = CreateProjectRequestSchema.shape;

export const ProjectFormSchema = z.object({
  kind: projectCreate.kind,
  title: projectCreate.title,
  description: z.string().trim().min(1).max(2000),
  slug: z.string().superRefine((value, ctx) => {
    if (value.trim().length === 0) return; // empty ⇒ server generates it
    const result = SlugSchema.safeParse(value.trim());
    if (result.success) return;
    for (const issue of result.error.issues) {
      // Preserve the DISTINCTION the SSOT makes: a `custom` issue is the
      // canonical-UUID refusal, everything else is the grammar/length rule. No
      // baked message — an explicit one would outrank the localized error map.
      ctx.addIssue(
        issue.code === "custom"
          ? { code: "custom" }
          : { code: "invalid_format", format: "regex" },
      );
    }
  }),
});

export interface ProjectFormFields {
  kind: ProjectKind;
  title: string;
  description: string;
  slug: string;
}

/**
 * The 012 expert create/edit form (#1284, EARS-2). Same derivation rule as the
 * project form: `name` reuses the SSOT create-schema validator verbatim, and the
 * four publish-required fields reuse the SSOT length CONSTANTS rather than a
 * re-typed bound, so the client and the API can never drift.
 *
 * Where it deliberately differs from `ProjectFormSchema`: professional role,
 * credentials, affiliation and bio are OPTIONAL in the form. The API accepts a
 * draft expert with only a display name (`CreateExpertRequestSchema` — every
 * other field is `.nullish()`), and an expert record is routinely started from a
 * business card and completed later. Forcing all five at authoring time would
 * make the form refuse a state the platform itself considers legal. Publication
 * still demands them — the server answers `PUBLISH_REQUIREMENTS_NOT_MET` (#1287)
 * — and the form says so under each box.
 */
const expertCreate = CreateExpertRequestSchema.shape;

/** Empty box ⇒ the field is cleared/omitted; a non-empty one is bounded by the SSOT max. */
function optionalBoundedText(max: number) {
  return z.string().trim().max(max);
}

export const ExpertFormSchema = z.object({
  name: expertCreate.name,
  professionalRole: optionalBoundedText(EXPERT_PROFESSIONAL_ROLE_MAX),
  credentials: optionalBoundedText(EXPERT_CREDENTIALS_MAX),
  affiliation: optionalBoundedText(EXPERT_AFFILIATION_MAX),
  bio: optionalBoundedText(EXPERT_BIO_MAX),
  slug: z.string().superRefine((value, ctx) => {
    if (value.trim().length === 0) return; // empty ⇒ server generates it
    const result = SlugSchema.safeParse(value.trim());
    if (result.success) return;
    for (const issue of result.error.issues) {
      ctx.addIssue(
        issue.code === "custom"
          ? { code: "custom" }
          : { code: "invalid_format", format: "regex" },
      );
    }
  }),
});

export interface ExpertFormFields {
  name: string;
  professionalRole: string;
  credentials: string;
  affiliation: string;
  bio: string;
  slug: string;
}

/**
 * The 012 topic create/edit form (#1285, EARS-3) — the thinnest of the four
 * taxonomy forms, and deliberately so: a curated topic IS a title plus the
 * permanent address it will be reachable at (012-requirements EARS-3; §2.2
 * matrix). There is no description, no media and no second descriptive column,
 * so the form has exactly two boxes and adding a third would be inventing an
 * entity shape the API refuses (`CreateTopicRequestSchema` is `.strict()`).
 *
 * `title` reuses the SSOT create-schema validator verbatim (trim + 1…120), and
 * `slug` follows the same "empty box ⇒ the server generates it" rule the project
 * and expert forms established — emptiness is legal, only a non-empty value is
 * checked against the SSOT slug grammar.
 */
const topicCreate = CreateTopicRequestSchema.shape;

export const TopicFormSchema = z.object({
  title: topicCreate.title,
  slug: z.string().superRefine((value, ctx) => {
    if (value.trim().length === 0) return; // empty ⇒ server generates it
    const result = SlugSchema.safeParse(value.trim());
    if (result.success) return;
    for (const issue of result.error.issues) {
      // Same distinction the sibling forms keep: `custom` is the canonical-UUID
      // refusal, everything else the grammar/length rule. No baked message — an
      // explicit one would outrank the localized per-parse error map.
      ctx.addIssue(
        issue.code === "custom"
          ? { code: "custom" }
          : { code: "invalid_format", format: "regex" },
      );
    }
  }),
});

export interface TopicFormFields {
  title: string;
  slug: string;
}

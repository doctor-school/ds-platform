import { z } from "zod";
import {
  ConfigureStreamRequestSchema,
  CreateEventExpertRequestSchema,
  CreateEventRequestSchema,
  CreateExpertRequestSchema,
  CreatePartnerRequestSchema,
  CreateProjectRequestSchema,
  CreateDirectionRequestSchema,
  CreateDirectionSpecialtyRequestSchema,
  type DirectionAdjacencyKind,
  DirectionAdjacencyKindSchema,
  DurationSecSchema,
  EmbedRefSchema,
  EVENT_EXPERT_POSITION_MAX,
  LegacyBroadcastCreateBodySchema,
  EXPERT_AFFILIATION_MAX,
  EXPERT_BIO_MAX,
  EXPERT_CREDENTIALS_MAX,
  EXPERT_PROFESSIONAL_ROLE_MAX,
  PARTNER_WEBSITE_URL_MAX,
  PartnerWebsiteUrlSchema,
  POSTER_REF_MAX,
  PosterRefSchema,
  type ProjectKind,
  RECORDING_DURATION_SEC_MAX,
  type RecordingKind,
  RecordingKindSchema,
  RecordingExpectedBySchema,
  refineEmbedRefForProvider,
  type StreamProvider,
  StreamProviderSchema,
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
/** The 014 EARS-24 «архивный эфир» body — the legacy half of the same form. */
const legacyCreate = LegacyBroadcastCreateBodySchema.shape;

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
 * ("" when empty) that only the PLATFORM variant of the form carries, so its rule
 * is applied in the refinement rather than at the object level; `programPdf` is
 * validated separately (a File, not a JSON field).
 *
 * 014 EARS-24 (#1741) adds `legacy` — «Это архивный эфир» — and the recording
 * block it makes mandatory. There is deliberately NO second schema: the owner's
 * decision is one create form with a checkbox, so the checkbox is a FIELD here
 * and the recording rules are conditional rather than a parallel validator. The
 * recording sub-object is nested under `recording` so its issue paths end in the
 * very field names (`embedRef`) the localized
 * resolver already branches on — the RU sentence an operator reads is the same
 * one the attach dialog shows, from the same SSOT refinement.
 */
export function eventFormSchema({
  requireRecording,
}: {
  /**
   * Whether the «Запись» block is part of THIS form — true on create with «Это
   * архивный эфир» checked, false on the edit form of an existing эфир.
   */
  requireRecording: boolean;
}) {
  return z
    .object({
      title: create.title,
      // Validated in the refinement below, not here: «Школа / серия» is REQUIRED
      // for a platform broadcast (`CreateEvent`) and optional for an архивный эфир
      // (`LegacyBroadcastCreateBody` defaults it to ""), because an эфир that
      // predates the platform routinely predates the series taxonomy too. Both
      // rules are the SSOT's own — the branch picks which one applies.
      school: z.string(),
      startsAtMsk: create.startsAtMsk,
      durationMin: create.durationMin,
      description: create.description,
      // Validated in the refinement below, not here: the partner reference is a
      // PLATFORM-only field. The legacy variant of the form does not render it
      // (`LegacyBroadcastCreateBody` has no such key), so a value left over from
      // before the box was checked must not fail a submit on a field the operator
      // can no longer see or clear.
      partnerRef: z.string(),
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
      legacy: z.boolean(),
      // Free-text at the object level; the CONDITIONAL rules below are what make it
      // a real source triple, so an untouched block on a platform event is not an
      // error the operator has to clear before saving.
      recording: z.object({
        kind: RecordingKindSchema,
        provider: StreamProviderSchema,
        embedRef: z.string(),
      }),
    })
    .superRefine((values, ctx) => {
      const school = (
        values.legacy ? legacyCreate.school : create.school
      ).safeParse(values.school);
      if (!school.success) {
        for (const issue of school.error.issues) {
          const { message: _resolved, ...rest } = issue;
          ctx.addIssue({ ...rest, path: ["school"] } as never);
        }
      }

      if (!values.legacy) {
        const partnerRef = create.partnerRef.safeParse(values.partnerRef);
        if (!partnerRef.success) {
          for (const issue of partnerRef.error.issues) {
            const { message: _resolved, ...rest } = issue;
            ctx.addIssue({ ...rest, path: ["partnerRef"] } as never);
          }
        }
      }

      // The recording block is authored WITH the эфир and only then: on the edit
      // form the «Записи» tab owns recordings, the block is not rendered, and a
      // requirement here would make an existing архивный эфир unsavable.
      if (!values.legacy || !requireRecording) return;
      const result = RecordingSourceRefSchema.safeParse(values.recording);
      if (result.success) return;
      for (const issue of result.error.issues) {
        // Re-pathed under `recording`, and stripped of its already-resolved
        // `message`: an explicit message outranks the localized per-parse error
        // map and would leak English into the form (#200 precedent). Everything
        // else — the `custom` provider tag `params.shape` included — is carried
        // through unchanged, which is what keeps this a fold of the SSOT rule
        // rather than a second copy of it.
        const { message: _resolved, path, ...rest } = issue;
        ctx.addIssue({
          ...rest,
          path: ["recording", ...(path ?? [])],
        } as never);
      }
    });
}

/** The CREATE form's schema — the recording block is part of it. */
export const EventFormSchema = eventFormSchema({ requireRecording: true });

/** The EDIT form's schema — recordings live in the «Записи» tab by then. */
export const EventEditFormSchema = eventFormSchema({ requireRecording: false });

export interface EventRecordingFields {
  kind: RecordingKind;
  provider: StreamProvider;
  embedRef: string;
}

export interface EventFormFields {
  title: string;
  school: string;
  startsAtMsk: string;
  durationMin: number;
  description: string;
  partnerRef: string;
  specialtiesText: string;
  /** 014 EARS-24 — «Это архивный эфир» (server-assigned `legacy` origin). */
  legacy: boolean;
  recording: EventRecordingFields;
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
 * Slug is intentionally absent: every mutation derives it server-side and the
 * admin only exposes the resulting public link after save.
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
});

export interface ProjectFormFields {
  kind: ProjectKind;
  title: string;
  description: string;
}

/**
 * The 012 Expert form (EARS-19/20). Required family/given names reuse the SSOT
 * validators; patronymic is optional, User is a closed Combobox UUID (or empty),
 * and slug is absent because every mutation derives it server-side.
 *
 * Where it deliberately differs from `ProjectFormSchema`: professional role,
 * credentials, affiliation and bio are OPTIONAL in the form. The API accepts a
 * draft expert with only structured names (`CreateExpertRequestSchema` — every
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
  familyName: expertCreate.familyName,
  givenName: expertCreate.givenName,
  patronymic: z.string().trim().max(80),
  userId: z.union([z.literal(""), z.uuid()]),
  professionalRole: optionalBoundedText(EXPERT_PROFESSIONAL_ROLE_MAX),
  credentials: optionalBoundedText(EXPERT_CREDENTIALS_MAX),
  affiliation: optionalBoundedText(EXPERT_AFFILIATION_MAX),
  bio: optionalBoundedText(EXPERT_BIO_MAX),
});

export interface ExpertFormFields {
  familyName: string;
  givenName: string;
  patronymic: string;
  userId: string;
  professionalRole: string;
  credentials: string;
  affiliation: string;
  bio: string;
}

/**
 * The 012 direction create/edit form (#1285, EARS-3) — the thinnest of the four
 * taxonomy forms, and deliberately so: a curated direction IS a title plus the
 * permanent address it will be reachable at (012-requirements EARS-3; §2.2
 * matrix). There is no description, no media and no second descriptive column,
 * so the form has exactly two boxes and adding a third would be inventing an
 * entity shape the API refuses (`CreateDirectionRequestSchema` is `.strict()`).
 *
 * `title` reuses the SSOT create-schema validator verbatim (trim + 1…120), and
 * it is the ONLY box: «адрес страницы» is derived from the title by the server
 * and frozen on first publish (017-design §9.3), so there is no slug field to
 * validate here — `CreateDirectionRequestSchema` is `.strict()` and would refuse
 * one outright.
 */
const directionCreate = CreateDirectionRequestSchema.shape;

export const DirectionFormSchema = z.object({
  title: directionCreate.title,
});

export interface DirectionFormFields {
  title: string;
}

/**
 * The 012 partner create/edit form (#1286, EARS-4). Same derivation rule as the
 * sibling taxonomy forms: `title` reuses the SSOT create-schema validator
 * verbatim, and the website box folds the SSOT `PartnerWebsiteUrlSchema` back in
 * rather than re-typing the https rule — that regex is the exact twin of the DB
 * CHECK `partners_website_url_https`, so the sentence the operator reads before
 * submit is the rule the column enforces.
 *
 * A partner is a descriptive card: a required display title, an optional site
 * link and an optional logo. `websiteUrl` is therefore OPTIONAL in the form (the
 * API takes a draft partner carrying nothing but a title) and a non-empty value
 * is the only thing checked — an empty box means «сайта нет», not «invalid».
 */
const partnerCreate = CreatePartnerRequestSchema.shape;

export const PartnerFormSchema = z.object({
  title: partnerCreate.title,
  websiteUrl: z.string().superRefine((value, ctx) => {
    if (value.trim().length === 0) return; // empty ⇒ the partner has no site
    const result = PartnerWebsiteUrlSchema.safeParse(value.trim());
    if (result.success) return;
    for (const issue of result.error.issues) {
      // Keep the DISTINCTION the SSOT makes: over the length cap is its own
      // sentence, everything else is the "absolute https:// address" rule. No
      // baked message — an explicit one would outrank the localized error map.
      ctx.addIssue(
        issue.code === "too_big"
          ? {
              code: "too_big",
              origin: "string",
              maximum: PARTNER_WEBSITE_URL_MAX,
              inclusive: true,
            }
          : { code: "invalid_format", format: "regex" },
      );
    }
  }),
});

export interface PartnerFormFields {
  title: string;
  websiteUrl: string;
}

/**
 * The 014 recordings source form (#1339 — attach and edit share one shape, exactly
 * as the event create/edit forms do: both author the same source triple).
 *
 * DERIVED from the `@ds/schemas` SSOT: the provider enum, the embed-reference
 * bounds and the per-provider reference shape all come from the SAME validators
 * feature 006's stream config runs (`refineEmbedRefForProvider`), so «is this a
 * valid rutube id» keeps one answer across the live room and the recording.
 *
 * The two optional fields are TEXT boxes here, not `number | null` — an operator
 * types into a box, and an empty box means «none». So emptiness is legal at the
 * form layer and only a NON-empty value is folded back through the SSOT
 * validator; the panel converts «» to the `null`/absent the API expects.
 */
const recordingSourceRef = z.object({
  provider: StreamProviderSchema,
  embedRef: EmbedRefSchema,
});

/**
 * The source REFERENCE alone — provider + embed reference, with the SSOT
 * per-provider shape refinement. It is what the create-event form's «Запись»
 * block asks for (014 EARS-24): the owner refused a poster typed as a storage
 * key and a hand-typed duration on Stage B (2026-09-03), and both arrive as a
 * file upload / a metadata read in #1611 (EARS-20). Sharing the base object
 * keeps «is this a valid rutube id» a single answer across all three surfaces.
 */
export const RecordingSourceRefSchema = recordingSourceRef.superRefine(
  (values, ctx) => {
    refineEmbedRefForProvider(ctx, values.provider, values.embedRef);
  },
);

export const RecordingSourceFormSchema = recordingSourceRef
  .extend({
    posterRef: z.string(),
    durationSecText: z.string(),
  })
  .superRefine((values, ctx) => {
    refineEmbedRefForProvider(ctx, values.provider, values.embedRef);

    const poster = values.posterRef.trim();
    if (poster.length > 0 && !PosterRefSchema.safeParse(poster).success) {
      ctx.addIssue({
        code: "too_big",
        origin: "string",
        maximum: POSTER_REF_MAX,
        inclusive: true,
        path: ["posterRef"],
      });
    }

    const duration = values.durationSecText.trim();
    if (duration.length === 0) return;
    const parsed = DurationSecSchema.safeParse(duration);
    if (parsed.success) return;
    // Preserve the DISTINCTION the SSOT makes: over the 24h cap is its own
    // actionable sentence, everything else ("", "abc", 0, -1) is the same
    // "positive whole number of seconds" guidance.
    ctx.addIssue(
      parsed.error.issues.some((issue) => issue.code === "too_big")
        ? {
            code: "too_big",
            origin: "number",
            maximum: RECORDING_DURATION_SEC_MAX,
            inclusive: true,
            path: ["durationSecText"],
          }
        : { code: "custom", path: ["durationSecText"] },
    );
  });

export interface RecordingSourceFields {
  provider: StreamProvider;
  embedRef: string;
  posterRef: string;
  durationSecText: string;
}

/**
 * 014 EARS-1 (#1339) — the event-level readiness date box.
 *
 * An empty box is legal and means «no promise» (the panel sends `null` to clear
 * it); anything else must be the SAME calendar-checked day the API enforces, so
 * the SSOT schema is folded in rather than re-typed. The date control keeps a
 * typed-in value the browser could not parse in its own buffer and hands the
 * form an empty string, so this guard is not the only thing standing between the
 * operator and a bad date — but a pasted `2026-13-45` is caught here, in RU, on
 * blur, instead of coming back as the server's generic "проверьте поля".
 */
export const RecordingExpectedByFormSchema = z.object({
  // One refinement rather than `z.union([z.literal(""), …])`: a union reports one
  // issue PER member, and the box has exactly one sentence to say — two issues
  // carrying the same message is noise the form layer would have to de-duplicate.
  expectedBy: z
    .string()
    .refine(
      (value) =>
        value === "" || RecordingExpectedBySchema.safeParse(value).success,
    ),
});

export interface RecordingExpectedByFields {
  expectedBy: string;
}

/**
 * 012 EARS-7 (#1289) — the event↔expert link form. Create and edit share one
 * shape: both author the same triple (which expert, what role, which slot), and
 * the edit simply cannot move the expert (re-pointing a link at another expert
 * would rewrite a row the audit ledger already attributes — that is a retire
 * plus a new link, 012-design §5.1), so the edit renders the expert box
 * disabled rather than a second schema.
 *
 * DERIVED from the `@ds/schemas` SSOT rather than re-typed: the role trim/length
 * bounds and the 0–32767 slot range come from the same validators the API
 * enforces, so a refusal reads the same in the browser and on the wire.
 *
 * `position` is a TEXT box here, not a `number`. An operator types into a box,
 * and `<input type="number">` hands React an empty string for «12abc» — folding
 * the SSOT number check over the typed text is what lets «» and «abc» and «-1»
 * all resolve to the ONE actionable sentence («whole number 0…32767») while an
 * over-cap value keeps its own.
 */
export const EventExpertFormSchema = z
  .object({
    expertId: z.uuid(),
    role: CreateEventExpertRequestSchema.shape.role,
    positionText: z.string(),
  })
  .superRefine((values, ctx) => {
    const text = values.positionText.trim();
    // Parsed by hand rather than with `Number()`: `Number(" ")` is 0 and
    // `Number("1e3")` is 1000, so a blank box and an exponent would both slip
    // past as a legal slot the operator never typed.
    const parsed = CreateEventExpertRequestSchema.shape.position.safeParse(
      /^\d+$/.test(text) ? Number(text) : Number.NaN,
    );
    if (parsed.success) return;
    ctx.addIssue(
      parsed.error.issues.some((issue) => issue.code === "too_big")
        ? {
            code: "too_big",
            origin: "number",
            maximum: EVENT_EXPERT_POSITION_MAX,
            inclusive: true,
            path: ["positionText"],
          }
        : { code: "custom", path: ["positionText"] },
    );
  });

export interface EventExpertFormFields {
  expertId: string;
  role: string;
  positionText: string;
}

/**
 * #1483 — the direction↔specialty link form (ADR-0016 §5). The link carries no
 * attribute of its own: it IS the pair of endpoints, so the form has exactly two
 * boxes and there is no edit counterpart anywhere in the admin (the API exposes no
 * PATCH — re-pointing a link is retiring one and authoring another).
 *
 * Both ids reuse the SSOT create-schema validators verbatim rather than a re-typed
 * `z.uuid()`, so «what counts as a direction id» keeps one answer on both sides of
 * the wire.
 */
const directionSpecialtyCreate = CreateDirectionSpecialtyRequestSchema.shape;

export const DirectionSpecialtyFormSchema = z.object({
  directionId: directionSpecialtyCreate.directionId,
  specialtyMinzdravId: directionSpecialtyCreate.specialtyMinzdravId,
});

export interface DirectionSpecialtyFormFields {
  directionId: string;
  specialtyMinzdravId: string;
}

/**
 * #1483 — the direction adjacency form (ADR-0016 §5; 017-design §5, EARS-18).
 * Unlike the specialty link, an adjacency edge DOES carry an attribute of its own
 * — `kind` — so this form serves both create and edit, with one deliberate
 * asymmetry the API mirrors: the two ENDPOINTS are the edge's identity and are
 * therefore not patchable, so the edit renders them read-only rather than
 * validating a move the server would refuse.
 *
 * `weight` is NOT a field. It is a tuning parameter of the targeting resolution
 * with a server default, and 017-design §9.3 rules that a number no operator can
 * reason about does not earn a box — the API defaults it, so the form neither
 * collects nor sends it.
 *
 * The self-edge rule is NOT re-implemented here — it is asserted by the SSOT
 * `CreateDirectionAdjacencyRequestSchema` refinement, folded in below, so the
 * browser and the API refuse the same thing for the same reason.
 */
export const DirectionAdjacencyFormSchema = z
  .object({
    directionId: z.uuid(),
    adjacentDirectionId: z.uuid(),
    // The SSOT enum verbatim: «вид связи» is a closed vocabulary (017-design
    // §9.3), so the form validates membership, not a string shape.
    kind: DirectionAdjacencyKindSchema,
  })
  .superRefine((values, ctx) => {
    if (
      values.directionId &&
      values.directionId === values.adjacentDirectionId
    ) {
      ctx.addIssue({ code: "custom", path: ["adjacentDirectionId"] });
    }
  });

export interface DirectionAdjacencyFormFields {
  directionId: string;
  adjacentDirectionId: string;
  /**
   * `""` is «ещё не выбрано» — a state the SCHEMA refuses, which is exactly the
   * point: a closed vocabulary has no neutral member to pre-select, so an
   * unpicked kind must fail validation with a sentence rather than be silently
   * defaulted to whichever option happened to be listed first.
   */
  kind: DirectionAdjacencyKind | "";
}

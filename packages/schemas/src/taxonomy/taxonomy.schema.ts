import { z } from "zod";

// 012 — Content taxonomy contracts (API SSOT, ADR-0002 §3, ADR-0006 §6.2;
// 012-design §2.2, §5.1, §5.3, §6). Framework-agnostic: `apps/api` validates at
// the I/O boundary with these schemas, and the Refine admin (`apps/admin`)
// derives its client-side form resolver from the SAME objects — so a bound the
// server enforces is never re-typed by hand in the form (the #665 precedent).
//
// EARS-1 (#1283) authors the shared taxonomy vocabulary (status, slug, media
// limits, error codes, the idempotency/ETag protocol shapes) plus the `projects`
// DTOs. #1284–#1286 add their entity DTOs against this same vocabulary.

// ── Shared lifecycle + identity vocabulary ───────────────────────────────────

/** The retained three-state entity lifecycle (012-design §2.1, §3). */
export const TAXONOMY_STATUSES = ["draft", "published", "retired"] as const;
export const TaxonomyStatusSchema = z.enum(TAXONOMY_STATUSES);
export type TaxonomyStatus = z.infer<typeof TaxonomyStatusSchema>;

/** The closed project-kind set (012-design §2.1). */
export const PROJECT_KINDS = ["school", "media", "program"] as const;
export const ProjectKindSchema = z.enum(PROJECT_KINDS);
export type ProjectKind = z.infer<typeof ProjectKindSchema>;

/** Authored slug grammar — mirrors the `projects_slug_pattern` DB CHECK. */
export const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Canonical UUID text, forbidden as a slug so `/:idOrSlug` stays unambiguous. */
export const CANONICAL_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SLUG_MAX = 80;

/**
 * A system-owned slug. The shared response contract rejects both the wrong
 * grammar and the id namespace (012-design §2.1): a canonical UUID would make
 * `/:idOrSlug` ambiguous, while mutation inputs expose no slug field at all.
 */
export const SlugSchema = z
  .string()
  .min(1)
  .max(SLUG_MAX)
  .regex(
    SLUG_REGEX,
    "slug must be lowercase-ASCII words joined by single hyphens",
  )
  .refine((s) => !CANONICAL_UUID_REGEX.test(s), {
    message: "slug must not be canonical UUID text",
  });

/** A stable row id — canonical UUID text. */
export const TaxonomyIdSchema = z.string().regex(CANONICAL_UUID_REGEX);

// ── Media (012-design §2.2) ──────────────────────────────────────────────────

/** Accepted still-image input types. Animated containers are rejected by the decoder. */
export const ACCEPTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
/** Upload byte ceiling — 10 MiB. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Post-orientation per-side pixel ceiling. */
export const MAX_IMAGE_SIDE_PX = 6000;
/** Aggregate decoded-pixel budget — 25 megapixels. */
export const MAX_IMAGE_DECODED_PIXELS = 25_000_000;

/**
 * The canonical output profile version (012-design §2.2). It enters the request
 * fingerprint, so changing the codec build or any encode option MUST bump this —
 * that is what keeps "the same bytes under the same key" an honest claim across
 * a normalizer upgrade rather than a silent re-encode.
 */
export const MEDIA_PROFILE_VERSION = "webp-1";
/** Canonical stored MIME — every accepted still image is re-encoded to this. */
export const CANONICAL_IMAGE_MIME = "image/webp";

/**
 * The only media mutation a JSON body may express (012-design §5.1). A file part
 * means set/replace; `clear` drops the optional reference. Not accepted on
 * create (there is nothing to clear yet), and rejected alongside a file with 400
 * `MEDIA_INPUT_CONFLICT` — an ambiguous "both" request is never guessed at.
 */
export const MediaActionSchema = z.literal("clear");
export type MediaAction = z.infer<typeof MediaActionSchema>;

// ── Project authoring DTOs (012-design §2.2 matrix) ──────────────────────────

export const PROJECT_TITLE_MIN = 1;
export const PROJECT_TITLE_MAX = 160;
export const PROJECT_DESCRIPTION_MIN = 1;
export const PROJECT_DESCRIPTION_MAX = 2000;

const ProjectTitleSchema = z
  .string()
  .trim()
  .min(PROJECT_TITLE_MIN)
  .max(PROJECT_TITLE_MAX);
const ProjectDescriptionSchema = z
  .string()
  .trim()
  .min(PROJECT_DESCRIPTION_MIN)
  .max(PROJECT_DESCRIPTION_MAX);

/**
 * `POST /v1/admin/projects` — create one draft project.
 *
 * `.strict()` is load-bearing, not tidiness: client JSON must never carry
 * `coverRef`, an object key or a storage URL (012-design §5.1). A strict schema
 * turns an attempt to supply storage authority into 400 `VALIDATION_FAILED`
 * instead of an ignored field. `mediaAction` is likewise absent here — it is a
 * PATCH-only verb.
 *
 * `title` and `kind` are the required display identity; `description` is
 * publish-required and may stay null on a draft. Slug is always server-owned.
 */
export const CreateProjectRequestSchema = z
  .object({
    kind: ProjectKindSchema,
    title: ProjectTitleSchema,
    description: ProjectDescriptionSchema.nullish(),
  })
  .strict();
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

/**
 * `PATCH /v1/admin/projects/:id` — edit the same row.
 *
 * Omission means unchanged; an explicit `null` clears an optional or
 * still-incomplete draft field (012-design §2.2). Slug is absent because its
 * stable public identity is generated and retained by the server.
 */
export const UpdateProjectRequestSchema = z
  .object({
    kind: ProjectKindSchema.optional(),
    title: ProjectTitleSchema.optional(),
    description: ProjectDescriptionSchema.nullish(),
    mediaAction: MediaActionSchema.optional(),
  })
  .strict();
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequestSchema>;

/**
 * The admin detail projection. `coverUrl` is a server-issued signed/CDN URL
 * derived from the stored key at read time — the key itself never crosses the
 * wire (012-design §5.1). `version` backs the ETag the next PATCH must echo.
 */
export const ProjectAdminDetailSchema = z.object({
  id: z.string(),
  slug: SlugSchema,
  kind: ProjectKindSchema,
  title: z.string(),
  description: z.string().nullable(),
  coverUrl: z.string().nullable(),
  status: TaxonomyStatusSchema,
  /** Null until the first publish; once set, the slug is permanently locked. */
  firstPublishedAt: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectAdminDetail = z.infer<typeof ProjectAdminDetailSchema>;

/** One row of the admin list — the columns the table renders, nothing more. */
export const ProjectAdminListItemSchema = ProjectAdminDetailSchema.pick({
  id: true,
  slug: true,
  kind: true,
  title: true,
  status: true,
  version: true,
  updatedAt: true,
});
export type ProjectAdminListItem = z.infer<typeof ProjectAdminListItemSchema>;

/** Offset/page admin list envelope (ADR-0002 — admin pagination is offset-based). */
export const ProjectAdminListSchema = z.object({
  data: z.array(ProjectAdminListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ProjectAdminList = z.infer<typeof ProjectAdminListSchema>;

// ── Expert authoring DTOs (012-design §2.2 matrix; EARS-2, #1284) ───────────

export const EXPERT_PERSON_NAME_MIN = 1;
export const EXPERT_PERSON_NAME_MAX = 80;
export const EXPERT_PROFESSIONAL_ROLE_MIN = 1;
export const EXPERT_PROFESSIONAL_ROLE_MAX = 160;
export const EXPERT_CREDENTIALS_MIN = 1;
export const EXPERT_CREDENTIALS_MAX = 500;
export const EXPERT_AFFILIATION_MIN = 1;
export const EXPERT_AFFILIATION_MAX = 240;
export const EXPERT_BIO_MIN = 1;
export const EXPERT_BIO_MAX = 4000;

const ExpertPersonNameSchema = z
  .string()
  .trim()
  .min(EXPERT_PERSON_NAME_MIN)
  .max(EXPERT_PERSON_NAME_MAX);
const ExpertProfessionalRoleSchema = z
  .string()
  .trim()
  .min(EXPERT_PROFESSIONAL_ROLE_MIN)
  .max(EXPERT_PROFESSIONAL_ROLE_MAX);
const ExpertCredentialsSchema = z
  .string()
  .trim()
  .min(EXPERT_CREDENTIALS_MIN)
  .max(EXPERT_CREDENTIALS_MAX);
const ExpertAffiliationSchema = z
  .string()
  .trim()
  .min(EXPERT_AFFILIATION_MIN)
  .max(EXPERT_AFFILIATION_MAX);
const ExpertBioSchema = z
  .string()
  .trim()
  .min(EXPERT_BIO_MIN)
  .max(EXPERT_BIO_MAX);

/**
 * `POST /v1/admin/experts` — create one draft expert.
 *
 * `.strict()` is load-bearing exactly as it is for a project: client JSON must
 * never carry `photoRef`, an object key or a storage URL (012-design §5.1), so
 * an attempt to supply storage authority is 400 `VALIDATION_FAILED` rather than
 * a silently ignored field. `mediaAction` is PATCH-only and absent here.
 *
 * Structured family/given names are required on create; `patronymic` and the
 * one-to-one `userId` convergence link are optional. The system derives both
 * display name and slug; mutation input cannot author either one (EARS-19/20).
 */
export const CreateExpertRequestSchema = z
  .object({
    familyName: ExpertPersonNameSchema,
    givenName: ExpertPersonNameSchema,
    patronymic: ExpertPersonNameSchema.nullish(),
    userId: z.uuid().optional(),
    professionalRole: ExpertProfessionalRoleSchema.nullish(),
    credentials: ExpertCredentialsSchema.nullish(),
    affiliation: ExpertAffiliationSchema.nullish(),
    bio: ExpertBioSchema.nullish(),
  })
  .strict();
export type CreateExpertRequest = z.infer<typeof CreateExpertRequestSchema>;

/**
 * `PATCH /v1/admin/experts/:id` — edit the same row.
 *
 * Omission means unchanged; an explicit `null` clears an optional or
 * still-incomplete draft field (012-design §2.2). Family/given names accept no
 * null: only §2.4 editorial removal may clear them. `userId: null` is the one
 * explicit unlink command; omission keeps the current link. Slug stays absent.
 */
export const UpdateExpertRequestSchema = z
  .object({
    familyName: ExpertPersonNameSchema.optional(),
    givenName: ExpertPersonNameSchema.optional(),
    patronymic: ExpertPersonNameSchema.nullish(),
    /** Omission leaves the link unchanged; null explicitly unlinks. */
    userId: z.uuid().nullable().optional(),
    professionalRole: ExpertProfessionalRoleSchema.nullish(),
    credentials: ExpertCredentialsSchema.nullish(),
    affiliation: ExpertAffiliationSchema.nullish(),
    bio: ExpertBioSchema.nullish(),
    mediaAction: MediaActionSchema.optional(),
  })
  .strict();
export type UpdateExpertRequest = z.infer<typeof UpdateExpertRequestSchema>;

/**
 * Deterministic initials for an expert with no photo (012-design §2.2 — "expert
 * photo absence yields deterministic initials from the name").
 *
 * ONE implementation, server-side, surfaced on the DTO: the admin renders what
 * the API computed instead of deriving its own, so the avatar fallback in the
 * admin, the public projection (#1294) and the merged speaker projection
 * (#1290) can never disagree about the same person. Returns `""` for a name
 * with no letter or digit at all — the caller then shows a neutral avatar
 * rather than a fabricated glyph.
 */
export function expertInitials(name: string | null): string {
  if (!name) return "";
  const words = name
    .normalize("NFKC")
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, ""))
    .filter((w) => w.length > 0);
  const letters = words.slice(0, 2).map((w) => [...w][0] ?? "");
  return letters.join("").toLocaleUpperCase("ru-RU");
}

/** Derived display identity; never persisted in `experts`. */
export function expertDisplayName(input: {
  familyName: string | null;
  givenName: string | null;
  patronymic: string | null;
}): string | null {
  if (!input.familyName || !input.givenName) return null;
  return [input.familyName, input.givenName, input.patronymic]
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

/**
 * The admin detail projection. `photoUrl` is a server-issued signed/CDN URL
 * derived from the stored key at read time — the key itself never crosses the
 * wire (012-design §5.1). `initials` is the server-computed avatar fallback.
 * `contentRemovedAt` is present and null for every row this slice can produce;
 * it becomes non-null only through #1306's editorial removal, and the admin
 * reads it to know that no restore control may be offered (EARS-14).
 */
export const ExpertAdminDetailSchema = z.object({
  id: z.string(),
  slug: SlugSchema,
  /** Null only on an editorially removed row (#1306); the admin then labels it «[удалён]». */
  name: z.string().nullable(),
  familyName: z.string().nullable(),
  givenName: z.string().nullable(),
  patronymic: z.string().nullable(),
  userId: z.uuid().nullable(),
  professionalRole: z.string().nullable(),
  credentials: z.string().nullable(),
  affiliation: z.string().nullable(),
  bio: z.string().nullable(),
  photoUrl: z.string().nullable(),
  /** Deterministic initials from the name — the no-photo avatar fallback. */
  initials: z.string(),
  status: TaxonomyStatusSchema,
  /** Null until the first publish; once set, the slug is permanently locked. */
  firstPublishedAt: z.string().nullable(),
  /** Non-null only after #1306's irreversible editorial removal. */
  contentRemovedAt: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ExpertAdminDetail = z.infer<typeof ExpertAdminDetailSchema>;

/** One row of the admin list — the columns the table renders, nothing more. */
export const ExpertAdminListItemSchema = ExpertAdminDetailSchema.pick({
  id: true,
  slug: true,
  name: true,
  professionalRole: true,
  status: true,
  version: true,
  updatedAt: true,
});
export type ExpertAdminListItem = z.infer<typeof ExpertAdminListItemSchema>;

/** Offset/page admin list envelope (ADR-0002 — admin pagination is offset-based). */
export const ExpertAdminListSchema = z.object({
  data: z.array(ExpertAdminListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ExpertAdminList = z.infer<typeof ExpertAdminListSchema>;

/** Maximum selector page size: bounded like every admin combobox (§4.1). */
export const ELIGIBLE_EXPERT_USER_PAGE_SIZE_MAX = 100;

/**
 * `GET /v1/admin/experts/eligible-users` query.
 *
 * `currentExpertId` is the edit-form exception: its already-linked User remains
 * selectable while Users owned by any other retained Expert stay absent. Search
 * is deliberately limited to the two operator-facing labels below; no Expert
 * name, phone, IdP subject or other identity heuristic participates.
 */
export const EligibleExpertUserQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(254).optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .max(ELIGIBLE_EXPERT_USER_PAGE_SIZE_MAX)
      .default(20),
    currentExpertId: z.uuid().optional(),
  })
  .strict();
export type EligibleExpertUserQuery = z.infer<
  typeof EligibleExpertUserQuerySchema
>;

/** Minimal platform-admin option label; excludes separate contact fields, IdP subject and roles. */
export const EligibleExpertUserOptionSchema = z
  .object({
    id: z.uuid(),
    displayName: z.string().nullable(),
    /** Guaranteed by `users_email_or_phone`: email when present, otherwise phone. */
    identifier: z.string().min(1),
  })
  .strict();
export type EligibleExpertUserOption = z.infer<
  typeof EligibleExpertUserOptionSchema
>;

/** Stable offset-paged selector envelope (ADR-0002 admin-list convention). */
export const EligibleExpertUserListSchema = z
  .object({
    data: z.array(EligibleExpertUserOptionSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  })
  .strict();
export type EligibleExpertUserList = z.infer<
  typeof EligibleExpertUserListSchema
>;

// ── Direction authoring DTOs (012-design §2.2 matrix; EARS-3, #1285) ────────────

export const DIRECTION_TITLE_MIN = 1;
export const DIRECTION_TITLE_MAX = 120;

const DirectionTitleSchema = z
  .string()
  .trim()
  .min(DIRECTION_TITLE_MIN)
  .max(DIRECTION_TITLE_MAX);

/**
 * `POST /v1/admin/directions` — create one draft direction.
 *
 * The thinnest create body of the four entities: a direction is a title plus its
 * permanent public identity (§2 ER; §5.2 `PublicDirection { id, slug, title }`).
 * There is no description and no media, so this request is always
 * `application/json` (§5.1) and carries no `mediaAction`.
 *
 * `.strict()` is load-bearing here for a different reason than it is for a
 * project or an expert: there is no media reference to smuggle in, but a client
 * that posts `description` or `coverRef` is asking for a direction shape this
 * feature deliberately does NOT have — a silently ignored field would let the
 * admin believe it stored something. 400 `VALIDATION_FAILED` instead.
 *
 * `slug` is NOT part of this contract (017-design §9.3). «Адрес страницы» is
 * derived from the Russian title by the server and retained for the row's
 * lifetime; it is not an editorial decision. Under
 * `.strict()` a posted `slug` is therefore a 400 rather than a silently honoured
 * override — the derivation has exactly one implementation, and a client cannot
 * opt out of it.
 */
export const CreateDirectionRequestSchema = z
  .object({
    title: DirectionTitleSchema,
  })
  .strict();
export type CreateDirectionRequest = z.infer<
  typeof CreateDirectionRequestSchema
>;

/**
 * `PATCH /v1/admin/directions/:id` — edit the same row.
 *
 * Omission means unchanged; `title` does not accept `null` (it is the row's only
 * descriptive value and NOT NULL in the DB). There is no `slug` here either: the
 * address never arrives from the operator, so row identity stays stable by
 * construction rather than by a publication-state refusal.
 */
export const UpdateDirectionRequestSchema = z
  .object({
    title: DirectionTitleSchema.optional(),
  })
  .strict();
export type UpdateDirectionRequest = z.infer<
  typeof UpdateDirectionRequestSchema
>;

/**
 * The admin detail projection. `version` backs the ETag the next PATCH must
 * echo.
 *
 * `slug` is still READ here — the storefront resolves a direction by it and the
 * admin needs it to build a preview link — but there is no `slugEditable`
 * counterpart any more: the address is derived and never authored, so "may the
 * operator still change the public URL" is a question with one permanent answer
 * and a boolean stating it would be an affordance the interface does not offer.
 */
export const DirectionAdminDetailSchema = z.object({
  id: z.string(),
  slug: SlugSchema,
  title: z.string(),
  status: TaxonomyStatusSchema,
  /** Null until the first publish; once set, the derived slug is permanently frozen. */
  firstPublishedAt: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DirectionAdminDetail = z.infer<typeof DirectionAdminDetailSchema>;

/** One row of the admin list — the columns the table renders, nothing more. */
export const DirectionAdminListItemSchema = DirectionAdminDetailSchema.pick({
  id: true,
  slug: true,
  title: true,
  status: true,
  version: true,
  updatedAt: true,
});
export type DirectionAdminListItem = z.infer<
  typeof DirectionAdminListItemSchema
>;

/** Offset/page admin list envelope (ADR-0002 — admin pagination is offset-based). */
export const DirectionAdminListSchema = z.object({
  data: z.array(DirectionAdminListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type DirectionAdminList = z.infer<typeof DirectionAdminListSchema>;

// ── Partner authoring DTOs (012-design §2.2 matrix; EARS-4, #1286) ──────────

export const PARTNER_TITLE_MIN = 1;
export const PARTNER_TITLE_MAX = 160;
export const PARTNER_WEBSITE_URL_MAX = 2048;

const PartnerTitleSchema = z
  .string()
  .trim()
  .min(PARTNER_TITLE_MIN)
  .max(PARTNER_TITLE_MAX);

/**
 * An absolute HTTPS partner website (012-design §2.2 — "optional absolute HTTPS
 * website up to 2048"). Three refusals, not one:
 *
 * - a non-absolute value (`doctor.school`, `/about`) has no origin to link to;
 * - any scheme other than `https:` — `http:` would downgrade a doctor-facing
 *   outbound link, and `javascript:`/`data:` are injection vectors, so the
 *   allow-list is a single scheme rather than a deny-list of bad ones;
 * - a URL with no host (`https://`, `https:///x`).
 *
 * The value is stored VERBATIM, never rewritten into a "fixed" form: a sponsor's
 * URL is their identity, and silently normalizing it could point the public link
 * somewhere they did not authorize.
 *
 * The rule is expressed as a PATTERN rather than a WHATWG `new URL()` parse for
 * two reasons. This package is the environment-agnostic contract SSOT — it
 * compiles against `lib: ES2022` alone and must hold in a browser, in Node and in
 * the Expo runtime, so it cannot reach for a host global. And the identical
 * pattern is the DB CHECK `partners_website_url_https` (migration 0019), so the
 * contract edge and the column enforce ONE rule instead of two validators that
 * can drift apart; `partners-schema.e2e-spec.ts` proves the column agrees.
 */
export const PARTNER_WEBSITE_URL_PATTERN = /^https:\/\/[^\s/?#]+[^\s]*$/;

export const PartnerWebsiteUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(PARTNER_WEBSITE_URL_MAX)
  .regex(
    PARTNER_WEBSITE_URL_PATTERN,
    "website must be an absolute https:// URL",
  );

/**
 * `POST /v1/admin/partners` — create one draft partner.
 *
 * `.strict()` is load-bearing exactly as it is for a project or an expert:
 * client JSON must never carry `logoRef`, an object key or a storage URL
 * (012-design §5.1), so an attempt to supply storage authority is 400
 * `VALIDATION_FAILED` rather than a silently ignored field. `mediaAction` is
 * PATCH-only and absent here.
 *
 * `title` is the required display identity; `websiteUrl` and the logo are
 * optional and stay optional after publication — §5.2's `PublicPartner`
 * declares both nullable, so neither is publish-required.
 */
export const CreatePartnerRequestSchema = z
  .object({
    title: PartnerTitleSchema,
    websiteUrl: PartnerWebsiteUrlSchema.nullish(),
  })
  .strict();
export type CreatePartnerRequest = z.infer<typeof CreatePartnerRequestSchema>;

/**
 * `PATCH /v1/admin/partners/:id` — edit the same row.
 *
 * Omission means unchanged; an explicit `null` clears the optional website.
 * `title` accepts no null: it is the row's display identity and NOT NULL in the
 * DB. Slug is absent because its stable public identity is generated and
 * retained by the server. `mediaAction: "clear"` drops the logo.
 */
export const UpdatePartnerRequestSchema = z
  .object({
    title: PartnerTitleSchema.optional(),
    websiteUrl: PartnerWebsiteUrlSchema.nullish(),
    mediaAction: MediaActionSchema.optional(),
  })
  .strict();
export type UpdatePartnerRequest = z.infer<typeof UpdatePartnerRequestSchema>;

/**
 * The admin detail projection. `logoUrl` is a server-issued signed/CDN URL
 * derived from the stored key at read time — the key itself never crosses the
 * wire (012-design §5.1). `version` backs the ETag the next PATCH must echo.
 */
export const PartnerAdminDetailSchema = z.object({
  id: z.string(),
  slug: SlugSchema,
  title: z.string(),
  logoUrl: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  status: TaxonomyStatusSchema,
  /** Null until the first publish; once set, the slug is permanently locked. */
  firstPublishedAt: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PartnerAdminDetail = z.infer<typeof PartnerAdminDetailSchema>;

/** One row of the admin list — the columns the table renders, nothing more. */
export const PartnerAdminListItemSchema = PartnerAdminDetailSchema.pick({
  id: true,
  slug: true,
  title: true,
  websiteUrl: true,
  status: true,
  version: true,
  updatedAt: true,
});
export type PartnerAdminListItem = z.infer<typeof PartnerAdminListItemSchema>;

/** Offset/page admin list envelope (ADR-0002 — admin pagination is offset-based). */
export const PartnerAdminListSchema = z.object({
  data: z.array(PartnerAdminListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type PartnerAdminList = z.infer<typeof PartnerAdminListSchema>;

// ── Event↔expert link (012 EARS-7, #1289) ───────────────────────────────────

/** The retained two-state JOIN lifecycle (012-design §2.1, §3 `JoinLifecycle`). */
export const RELATIONSHIP_STATUSES = ["active", "retired"] as const;
export const RelationshipStatusSchema = z.enum(RELATIONSHIP_STATUSES);
export type RelationshipStatus = z.infer<typeof RelationshipStatusSchema>;

/**
 * The closed `project_experts.role` set (012-design §2.1, EARS-9). Declared with
 * the shared join vocabulary rather than inside the `project_experts` DTO block
 * below, because the §5.2 public item DTOs — which are authored much earlier in
 * this file — extend `PublicExpertSummary` with exactly this enum.
 *
 * `curator` is the accountable owner every published project must have exactly
 * one of; `member` is every other listed expert.
 */
export const PROJECT_EXPERT_ROLES = ["curator", "member"] as const;
export const ProjectExpertRoleSchema = z.enum(PROJECT_EXPERT_ROLES);
export type ProjectExpertRole = z.infer<typeof ProjectExpertRoleSchema>;

export const EVENT_EXPERT_ROLE_MIN = 1;
export const EVENT_EXPERT_ROLE_MAX = 80;
export const EVENT_EXPERT_POSITION_MIN = 0;
export const EVENT_EXPERT_POSITION_MAX = 32767;

/**
 * The event-specific role — trimmed 1–80 (012-design §2.2). Trim happens BEFORE
 * the length check, so a whitespace-only role is a length failure rather than a
 * stored blank; the DB CHECK mirrors the same bounds.
 */
const EventExpertRoleSchema = z
  .string()
  .trim()
  .min(EVENT_EXPERT_ROLE_MIN)
  .max(EVENT_EXPERT_ROLE_MAX);

/**
 * `position` is an integer step 1 from 0 through 32767 (012-design §2.2) — the
 * slot in the event's merged visible speaker projection. Not coerced: a string
 * position is a client bug, and silently parsing it would let `"1abc"` become 1.
 */
const EventExpertPositionSchema = z
  .number()
  .int()
  .min(EVENT_EXPERT_POSITION_MIN)
  .max(EVENT_EXPERT_POSITION_MAX);

/**
 * `POST /v1/admin/event-experts` — link one expert to one event (EARS-7).
 *
 * Since the EARS-24 cutover (#1607) this link IS the event's speaker: there is
 * no free-text list left to pair it with, so the command carries no name field
 * and no legacy match.
 */
export const CreateEventExpertRequestSchema = z
  .object({
    eventId: TaxonomyIdSchema,
    expertId: TaxonomyIdSchema,
    role: EventExpertRoleSchema,
    position: EventExpertPositionSchema,
  })
  .strict();
export type CreateEventExpertRequest = z.infer<
  typeof CreateEventExpertRequestSchema
>;

/**
 * `PATCH /v1/admin/event-experts/:id` — edit the SAME row. Omission means
 * unchanged.
 *
 * Neither endpoint is patchable: re-pointing a link at another event or another
 * expert would silently rewrite history on a row the audit ledger already
 * attributes. That is a retire plus a new link.
 */
export const UpdateEventExpertRequestSchema = z
  .object({
    role: EventExpertRoleSchema.optional(),
    position: EventExpertPositionSchema.optional(),
  })
  .strict();
export type UpdateEventExpertRequest = z.infer<
  typeof UpdateEventExpertRequestSchema
>;

/** The admin projection of one link (012-design §5.1). */
export const EventExpertAdminDetailSchema = z.object({
  id: TaxonomyIdSchema,
  eventId: TaxonomyIdSchema,
  expertId: TaxonomyIdSchema,
  /** Null only after §2.4's editorial removal cleared it (#1306). */
  role: z.string().nullable(),
  position: z.number().int(),
  status: RelationshipStatusSchema,
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EventExpertAdminDetail = z.infer<
  typeof EventExpertAdminDetailSchema
>;

export const EventExpertAdminListItemSchema = EventExpertAdminDetailSchema.pick(
  {
    id: true,
    eventId: true,
    expertId: true,
    role: true,
    position: true,
    status: true,
    version: true,
    updatedAt: true,
  },
);
export type EventExpertAdminListItem = z.infer<
  typeof EventExpertAdminListItemSchema
>;

/** Offset/page admin list envelope (ADR-0002 — admin pagination is offset-based). */
export const EventExpertAdminListSchema = z.object({
  data: z.array(EventExpertAdminListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type EventExpertAdminList = z.infer<typeof EventExpertAdminListSchema>;

/**
 * §5.2 public relationship summary of an expert. Fixed rather than inferred from
 * the full entity: no status, storage key, retained-row id or admin field is
 * present, and `photoUrl` is PRESENT and nullable rather than optional.
 */
export const PublicExpertSummarySchema = z.object({
  id: TaxonomyIdSchema,
  slug: SlugSchema,
  name: z.string(),
  professionalRole: z.string(),
  credentials: z.string(),
  affiliation: z.string(),
  photoUrl: z.string().nullable(),
});
export type PublicExpertSummary = z.infer<typeof PublicExpertSummarySchema>;

/**
 * `/events/:key/experts` → `PublicExpertSummary + { role, position }`
 * (012-design §5.2). The resolver behind it is EARS-8's (#1290); this is the
 * item shape it must produce.
 */
export const PublicEventExpertItemSchema = PublicExpertSummarySchema.extend({
  role: z.string(),
  position: z.number().int(),
});
export type PublicEventExpertItem = z.infer<typeof PublicEventExpertItemSchema>;

// ── Admin list paging bounds (012-design §5.1; the shell #1297 later sweeps) ─
//
// Declared ahead of both list-query schemas below: they are evaluated at module
// load, so a `const` declared after them would be in its temporal dead zone.

export const ADMIN_LIST_PAGE_SIZE_DEFAULT = 20;
export const ADMIN_LIST_PAGE_SIZE_MAX = 100;

// ── Public summary DTOs (012-design §5.2) ────────────────────────────────────

/**
 * The exact §5.2 relationship summary of a partner. Declared here by the first
 * join vertical because `PublicProjectSummary` embeds it; `project_partners`
 * (#1291) is what will ever make it non-null.
 */
export const PublicPartnerSummarySchema = z
  .object({
    id: z.string(),
    slug: SlugSchema,
    title: z.string(),
    logoUrl: z.string().nullable(),
    websiteUrl: z.string().nullable(),
  })
  .strict();
export type PublicPartnerSummary = z.infer<typeof PublicPartnerSummarySchema>;

/**
 * The exact §5.2 `PublicProjectSummary` — the item DTO of
 * `GET /v1/public/events/:key/projects`.
 *
 * `.strict()` is the disclosure boundary, not tidiness: §5.2 states «no status,
 * storage key, retained-row id or admin field is present», so a field added to
 * the admin projection can never leak here by being spread into the response.
 * Optional URLs are PRESENT and nullable — a caller never has to distinguish
 * «absent» from «none».
 */
export const PublicProjectSummarySchema = z
  .object({
    id: z.string(),
    slug: SlugSchema,
    kind: ProjectKindSchema,
    title: z.string(),
    description: z.string().nullable(),
    coverUrl: z.string().nullable(),
    primaryPartner: PublicPartnerSummarySchema.nullable(),
  })
  .strict();
export type PublicProjectSummary = z.infer<typeof PublicProjectSummarySchema>;

/**
 * The exact §5.2 `PublicEventSummary` — the item DTO of
 * `GET /v1/public/projects/:key/events`. `state` is the event's publish-visible
 * lifecycle state, which the 004 public event surface already discloses.
 */
export const PublicEventSummarySchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    school: z.string(),
    startsAt: z.string(),
    state: z.string(),
  })
  .strict();
export type PublicEventSummary = z.infer<typeof PublicEventSummarySchema>;

/**
 * The exact §5.2 `PublicDirectionSummary` — the item DTO of
 * `GET /v1/public/events/:key/directions` (012 EARS-11, #1293).
 *
 * A direction is the THINNEST taxonomy entity, and its summary is identical to
 * its full `PublicDirection { id, slug, title }`: there is no description, no media and
 * therefore no field a summary could drop. It is still declared as its own
 * schema rather than aliased, because §5.2 fixes the nested-route item DTO
 * INDEPENDENTLY of the opposite full entity — the traversal must not start
 * inheriting fields the day the entity grows one.
 */
export const PublicDirectionSummarySchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
  })
  .strict();
export type PublicDirectionSummary = z.infer<typeof PublicDirectionSummarySchema>;

/** ADR-0002's exact cursor-page envelope (012-design §5.2). */
export function publicCursorPageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    pagination: z.object({
      nextCursor: z.string().nullable(),
      hasMore: z.boolean(),
    }),
  });
}

export const PublicProjectSummaryPageSchema = publicCursorPageSchema(
  PublicProjectSummarySchema,
);
export type PublicProjectSummaryPage = z.infer<
  typeof PublicProjectSummaryPageSchema
>;
export const PublicEventSummaryPageSchema = publicCursorPageSchema(
  PublicEventSummarySchema,
);
export type PublicEventSummaryPage = z.infer<
  typeof PublicEventSummaryPageSchema
>;
export const PublicDirectionSummaryPageSchema = publicCursorPageSchema(
  PublicDirectionSummarySchema,
);
export type PublicDirectionSummaryPage = z.infer<
  typeof PublicDirectionSummaryPageSchema
>;

// ── §5.2 nested item DTOs of the project joins (EARS-9 #1291, EARS-10 #1292) ──
//
// 012-design §5.2 fixes each nested route's item shape rather than inferring it
// from the opposite full entity: the summary of the far endpoint PLUS the
// relationship's own attribute, and nothing else. The `.extend()` idiom mirrors
// `PublicEventExpertItemSchema` above.
//
// `PublicExpertSummarySchema` is a plain object rather than `.strict()`, so its
// extensions inherit that; the two project-side items extend the STRICT
// `PublicProjectSummarySchema` and stay strict, which is the disclosure boundary
// §5.2 asks for — an admin field can never reach these bodies by being spread in.

/** `/projects/:key/experts` → `PublicExpertSummary + { role }`. */
export const PublicProjectExpertItemSchema = PublicExpertSummarySchema.extend({
  role: ProjectExpertRoleSchema,
});
export type PublicProjectExpertItem = z.infer<
  typeof PublicProjectExpertItemSchema
>;

/** `/experts/:key/projects` → `PublicProjectSummary + { role }`. */
export const PublicExpertProjectItemSchema = PublicProjectSummarySchema.extend({
  role: ProjectExpertRoleSchema,
});
export type PublicExpertProjectItem = z.infer<
  typeof PublicExpertProjectItemSchema
>;

/** `/projects/:key/partners` → `PublicPartnerSummary + { isPrimary }`. */
export const PublicProjectPartnerItemSchema = PublicPartnerSummarySchema.extend(
  {
    isPrimary: z.boolean(),
  },
);
export type PublicProjectPartnerItem = z.infer<
  typeof PublicProjectPartnerItemSchema
>;

/** `/partners/:key/projects` → `PublicProjectSummary + { isPrimary }`. */
export const PublicPartnerProjectItemSchema = PublicProjectSummarySchema.extend(
  {
    isPrimary: z.boolean(),
  },
);
export type PublicPartnerProjectItem = z.infer<
  typeof PublicPartnerProjectItemSchema
>;

export const PublicProjectExpertItemPageSchema = publicCursorPageSchema(
  PublicProjectExpertItemSchema,
);
export type PublicProjectExpertItemPage = z.infer<
  typeof PublicProjectExpertItemPageSchema
>;
export const PublicExpertProjectItemPageSchema = publicCursorPageSchema(
  PublicExpertProjectItemSchema,
);
export type PublicExpertProjectItemPage = z.infer<
  typeof PublicExpertProjectItemPageSchema
>;
export const PublicProjectPartnerItemPageSchema = publicCursorPageSchema(
  PublicProjectPartnerItemSchema,
);
export type PublicProjectPartnerItemPage = z.infer<
  typeof PublicProjectPartnerItemPageSchema
>;
export const PublicPartnerProjectItemPageSchema = publicCursorPageSchema(
  PublicPartnerProjectItemSchema,
);
export type PublicPartnerProjectItemPage = z.infer<
  typeof PublicPartnerProjectItemPageSchema
>;

/** Bounded page size of every §5.2 growing public read. */
export const PUBLIC_PAGE_SIZE_DEFAULT = 20;
export const PUBLIC_PAGE_SIZE_MAX = 50;

/**
 * The `limit` + opaque `cursor` query of every §5.2 traversal. The cursor is
 * opaque BY CONTRACT — it encodes the stable order tuple the server chose, and a
 * client that decodes and edits it is holding a value the server refuses with
 * 400 `CURSOR_INVALID` rather than one it silently trusts.
 */
export const PublicCursorQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(PUBLIC_PAGE_SIZE_MAX)
      .default(PUBLIC_PAGE_SIZE_DEFAULT),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type PublicCursorQuery = z.infer<typeof PublicCursorQuerySchema>;

// ── Lifecycle-impact preview (012-design §3.1; EARS-6, #1288) ────────────────

/** The two transitions a preview may be issued for. A token binds exactly one. */
export const TAXONOMY_LIFECYCLE_TRANSITIONS = ["retire", "restore"] as const;
export const TaxonomyLifecycleTransitionSchema = z.enum(
  TAXONOMY_LIFECYCLE_TRANSITIONS,
);
export type TaxonomyLifecycleTransition = z.infer<
  typeof TaxonomyLifecycleTransitionSchema
>;

/**
 * The confirmation header carrying the signed envelope back (§3.1). Absent is
 * 428 `LIFECYCLE_IMPACT_REQUIRED`; tampered/expired/wrong-transition/
 * wrong-target/stale-fingerprint is 412 `LIFECYCLE_IMPACT_STALE`.
 */
export const LIFECYCLE_IMPACT_TOKEN_HEADER = "lifecycle-impact-token";
/** The §3.1 validity window of an issued envelope. */
export const LIFECYCLE_IMPACT_TOKEN_TTL_MS = 15 * 60 * 1000;

/**
 * The `kind` of one affected row (§3.1). An ENTITY kind is the singular noun; a
 * JOIN kind is its two endpoints in the order the kind names, joined by `↔`.
 * One closed union rather than two: the confirmation dialog renders a single
 * list, and a row's kind is what tells the operator whether «удалить» would
 * touch a record or merely a link.
 */
export const LIFECYCLE_IMPACT_ROW_KINDS = [
  "event",
  "project",
  "expert",
  "direction",
  "partner",
  "event↔project",
  "event↔expert",
  "event↔direction",
  "project↔expert",
  "project↔partner",
  // #1483 — the two joins a DIRECTION is an endpoint of. Retiring a direction
  // withdraws every targeting answer these edges feed (ADR-0016 §5), so a
  // preview that omitted them would understate the blast radius of the exact
  // transition 012 EARS-13 exists to make visible.
  "direction↔specialty",
  "direction↔direction",
] as const;
export const LifecycleImpactRowKindSchema = z.enum(LIFECYCLE_IMPACT_ROW_KINDS);
export type LifecycleImpactRowKind = z.infer<
  typeof LifecycleImpactRowKindSchema
>;

/**
 * Exactly `{ kind, id, title, slug, status }` (§3.1) — every affected row is
 * operator-readable ON ITS OWN, so the dialog renders the complete list from one
 * preview response with no follow-up read per affected id.
 *
 * `title` is ALWAYS present and never null: for an entity it is the row's title
 * (an expert's name); for a JOIN it is the operator-readable pairing
 * `«<left> — <right>»` of its two endpoints' display forms — the preview has
 * already loaded both endpoints to compute eligibility, so building it costs no
 * extra read. `slug` is null exactly for a join row and for any entity kind with
 * none. `status` is the row's OWN state: `published | retired` for an entity,
 * `active | retired` for a join. `draft` never appears — the affected list is
 * scoped to currently-public projections.
 *
 * These display fields widen no disclosure boundary: each is one the
 * corresponding public summary DTO already exposes, and `status` is read from
 * the affected row itself and disclosed only because this is an admin-only route
 * behind the `platform_admin` guard.
 */
export const LIFECYCLE_IMPACT_ROW_STATUSES = [
  "published",
  "retired",
  "active",
] as const;
export const LifecycleImpactRowStatusSchema = z.enum(
  LIFECYCLE_IMPACT_ROW_STATUSES,
);
export type LifecycleImpactRowStatus = z.infer<
  typeof LifecycleImpactRowStatusSchema
>;

export const LifecycleImpactRowSchema = z
  .object({
    kind: LifecycleImpactRowKindSchema,
    id: z.string(),
    title: z.string().min(1),
    slug: z.string().nullable(),
    status: LifecycleImpactRowStatusSchema,
  })
  .strict();
export type LifecycleImpactRow = z.infer<typeof LifecycleImpactRowSchema>;

/**
 * The §3.1 preview body. `version` is the target's version the envelope binds,
 * so a client that reads a preview and then confirms is asserting the SAME row
 * state twice — once via `If-Match`, once inside the opaque token.
 *
 * `impactToken` is a server-signed envelope binding transition, target kind/id/
 * version, issued-at and a 15-minute expiry to a canonical FINGERPRINT of every
 * retained incident relation and every opposite-endpoint eligibility input. The
 * fingerprint covers inactive relations and non-public endpoints that could
 * become visible WITHOUT returning their hidden content to the client — rows the
 * caller may not see are counted by the fingerprint, never listed in `affected`.
 */
export const LifecycleImpactSchema = z
  .object({
    transition: TaxonomyLifecycleTransitionSchema,
    version: z.number().int().positive(),
    affected: z.array(LifecycleImpactRowSchema),
    impactToken: z.string().min(1),
  })
  .strict();
export type LifecycleImpact = z.infer<typeof LifecycleImpactSchema>;

/** `GET .../:id/lifecycle-impact?transition=retire|restore`. */
export const LifecycleImpactQuerySchema = z
  .object({ transition: TaxonomyLifecycleTransitionSchema })
  .strict();
export type LifecycleImpactQuery = z.infer<typeof LifecycleImpactQuerySchema>;

// ── event_projects authoring DTOs (012-design §5.1; EARS-6, #1288) ───────────

/**
 * `POST /v1/admin/event-projects` — relate one project to one event.
 *
 * The body is the two endpoint ids and nothing else. `.strict()` is
 * load-bearing: a client must not be able to supply `status`, `version` or
 * `deletedAt` — lifecycle is moved by the retire/restore commands behind the
 * §3.1 impact gate, never by a create body, so an attempt is 400
 * `VALIDATION_FAILED` rather than a silently ignored field.
 *
 * There is no `PATCH` counterpart: unlike `project_experts` (`role`) or
 * `project_partners` (`is_primary`), an event↔project relationship carries NO
 * attribute (§2 ER envelope) — its endpoints are its identity and its lifecycle
 * is the two commands. A PATCH route here could only ever accept an empty body
 * and bump a version, which is a surface that asserts nothing.
 */
export const CreateEventProjectRequestSchema = z
  .object({
    eventId: TaxonomyIdSchema,
    projectId: TaxonomyIdSchema,
  })
  .strict();
export type CreateEventProjectRequest = z.infer<
  typeof CreateEventProjectRequestSchema
>;

/**
 * The admin projection of one relationship. It carries both endpoints' display
 * forms (`eventTitle` / `projectTitle`) because the admin relationship editor
 * renders a list of LINKS, and a table of two opaque UUIDs would force one
 * follow-up read per row — the same argument §3.1 makes for its `title`.
 */
export const EventProjectAdminDetailSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  eventTitle: z.string(),
  eventSlug: z.string(),
  projectId: z.string(),
  projectTitle: z.string(),
  projectSlug: z.string(),
  status: RelationshipStatusSchema,
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EventProjectAdminDetail = z.infer<
  typeof EventProjectAdminDetailSchema
>;

/** Offset/page admin list envelope (ADR-0002 — admin pagination is offset-based). */
export const EventProjectAdminListSchema = z.object({
  data: z.array(EventProjectAdminDetailSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type EventProjectAdminList = z.infer<typeof EventProjectAdminListSchema>;

/**
 * The filtered join list of §5.1. Either endpoint may scope the list — that is
 * how the admin renders «проекты этого эфира» and «эфиры этого проекта» from one
 * route — and retired rows are excluded unless explicitly asked for.
 */
export const EventProjectAdminListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .max(ADMIN_LIST_PAGE_SIZE_MAX)
      .default(ADMIN_LIST_PAGE_SIZE_DEFAULT),
    eventId: TaxonomyIdSchema.optional(),
    projectId: TaxonomyIdSchema.optional(),
    status: RelationshipStatusSchema.optional(),
    includeRetired: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .transform((v) => v === true || v === "true")
      .default(false),
  })
  .strict();
export type EventProjectAdminListQuery = z.infer<
  typeof EventProjectAdminListQuerySchema
>;

// ── event_directions authoring DTOs (012-design §5.1; EARS-11, #1293) ────────────

/**
 * `POST /v1/admin/event-directions` — classify one event under one existing direction.
 *
 * The body is the two endpoint ids and nothing else, and `.strict()` is what
 * makes «only existing non-retired directions, no inline creation» (EARS-11) a
 * SHAPE rule rather than a UI convention: there is no `title` or `slug` field a
 * client could send to have a direction created on the fly, so the only way to
 * classify an event is to reference a `directions` row that already exists. A
 * client must equally not be able to supply `status`, `version` or `deletedAt` —
 * lifecycle is moved by the retire/restore commands behind the §3.1 impact
 * gate, so an attempt is 400 `VALIDATION_FAILED`, never a silently ignored
 * field.
 *
 * `events.specialties[]` is deliberately absent from this contract in both
 * directions: it is a SEPARATE axis (012-requirements EARS-11 + the «different
 * axes and never synchronize» invariant), so no event-direction request reads or
 * writes it.
 *
 * There is no `PATCH` counterpart, for the same reason `event_projects` has
 * none: an event↔direction relationship carries NO attribute (§2 ER envelope) — its
 * endpoints are its identity and its lifecycle is the two commands.
 */
export const CreateEventDirectionRequestSchema = z
  .object({
    eventId: TaxonomyIdSchema,
    directionId: TaxonomyIdSchema,
  })
  .strict();
export type CreateEventDirectionRequest = z.infer<
  typeof CreateEventDirectionRequestSchema
>;

/**
 * The admin projection of one relationship. It carries both endpoints' display
 * forms (`eventTitle` / `directionTitle`) because the admin relationship editor
 * renders a list of LINKS, and a table of two opaque UUIDs would force one
 * follow-up read per row — the same argument §3.1 makes for its `title`.
 */
export const EventDirectionAdminDetailSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  eventTitle: z.string(),
  eventSlug: z.string(),
  directionId: z.string(),
  directionTitle: z.string(),
  directionSlug: z.string(),
  status: RelationshipStatusSchema,
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EventDirectionAdminDetail = z.infer<typeof EventDirectionAdminDetailSchema>;

/** Offset/page admin list envelope (ADR-0002 — admin pagination is offset-based). */
export const EventDirectionAdminListSchema = z.object({
  data: z.array(EventDirectionAdminDetailSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type EventDirectionAdminList = z.infer<typeof EventDirectionAdminListSchema>;

/**
 * The filtered join list of §5.1. Either endpoint may scope the list — that is
 * how the admin renders «направления этого эфира» and «эфиры этого
 * направления» from one
 * route — and retired rows are excluded unless explicitly asked for.
 */
export const EventDirectionAdminListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .max(ADMIN_LIST_PAGE_SIZE_MAX)
      .default(ADMIN_LIST_PAGE_SIZE_DEFAULT),
    eventId: TaxonomyIdSchema.optional(),
    directionId: TaxonomyIdSchema.optional(),
    status: RelationshipStatusSchema.optional(),
    includeRetired: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .transform((v) => v === true || v === "true")
      .default(false),
  })
  .strict();
export type EventDirectionAdminListQuery = z.infer<
  typeof EventDirectionAdminListQuerySchema
>;

// ── project_experts authoring DTOs (012-design §5.1; EARS-9, #1291) ──────────

/**
 * `POST /v1/admin/project-experts` — list one expert on one project with a role.
 *
 * `.strict()` is load-bearing exactly as it is on the event↔project create:
 * `status`, `version` and `deletedAt` are moved by the retire/restore commands,
 * never by a create body, so supplying one is 400 `VALIDATION_FAILED` rather
 * than a silently dropped field.
 *
 * Creating a `curator` row on a PUBLISHED project that already has one is
 * refused by the service with 409 `PUBLISHED_PROJECT_REQUIRES_CURATOR`-adjacent
 * `RELATIONSHIP_CONFLICT` and, underneath it, by the immediate partial unique
 * index — the curator SEAT is moved by `replace-curator`, not by a second create.
 */
export const CreateProjectExpertRequestSchema = z
  .object({
    projectId: TaxonomyIdSchema,
    expertId: TaxonomyIdSchema,
    role: ProjectExpertRoleSchema,
  })
  .strict();
export type CreateProjectExpertRequest = z.infer<
  typeof CreateProjectExpertRequestSchema
>;

/**
 * `PATCH /v1/admin/project-experts/:id` — edit the SAME row's role.
 *
 * Neither endpoint is patchable: re-pointing a relation would rewrite history
 * the audit ledger already attributes to the original pair, so a re-point is
 * retire + a new link. `role` is the only attribute this join has, and moving it
 * `member → curator` or `curator → member` on a published project runs the §3.2
 * invariant check — demoting the sole curator is 409
 * `PUBLISHED_PROJECT_REQUIRES_CURATOR`.
 */
export const UpdateProjectExpertRequestSchema = z
  .object({
    role: ProjectExpertRoleSchema.optional(),
  })
  .strict();
export type UpdateProjectExpertRequest = z.infer<
  typeof UpdateProjectExpertRequestSchema
>;

/**
 * `POST /v1/admin/projects/:id/replace-curator` (012-design §5.1 / §3.2) — the
 * ONLY curator-change path while the project is published, and an atomic one:
 * demote the incumbent to `member`, then create/restore/promote the candidate.
 * It carries the PROJECT's `If-Match`, not a relation's, because the invariant
 * it preserves belongs to the project.
 */
export const ReplaceProjectCuratorRequestSchema = z
  .object({ expertId: TaxonomyIdSchema })
  .strict();
export type ReplaceProjectCuratorRequest = z.infer<
  typeof ReplaceProjectCuratorRequestSchema
>;

/**
 * The admin projection of one project↔expert relation. Both endpoints' display
 * forms are inline for the same reason `EventProjectAdminDetail` carries them:
 * the admin renders a table of LINKS, and two opaque UUIDs per row would force a
 * follow-up read per row.
 *
 * `expertName` is nullable because §2.4's editorial removal nulls `experts.name`
 * on a retained row; the admin renders the fixed label `[удалён]` for it rather
 * than the API storing a sentinel string.
 */
export const ProjectExpertAdminDetailSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectTitle: z.string(),
  projectSlug: z.string(),
  expertId: z.string(),
  expertName: z.string().nullable(),
  expertSlug: z.string(),
  role: ProjectExpertRoleSchema,
  status: RelationshipStatusSchema,
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectExpertAdminDetail = z.infer<
  typeof ProjectExpertAdminDetailSchema
>;

/** Offset/page admin list envelope (ADR-0002 — admin pagination is offset-based). */
export const ProjectExpertAdminListSchema = z.object({
  data: z.array(ProjectExpertAdminDetailSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ProjectExpertAdminList = z.infer<
  typeof ProjectExpertAdminListSchema
>;

/** Either endpoint may scope the list — one route serves both panel directions. */
export const ProjectExpertAdminListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .max(ADMIN_LIST_PAGE_SIZE_MAX)
      .default(ADMIN_LIST_PAGE_SIZE_DEFAULT),
    projectId: TaxonomyIdSchema.optional(),
    expertId: TaxonomyIdSchema.optional(),
    role: ProjectExpertRoleSchema.optional(),
    status: RelationshipStatusSchema.optional(),
    includeRetired: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .transform((v) => v === true || v === "true")
      .default(false),
  })
  .strict();
export type ProjectExpertAdminListQuery = z.infer<
  typeof ProjectExpertAdminListQuerySchema
>;

// ── project_partners authoring DTOs (012-design §5.1; EARS-10, #1292) ────────

/**
 * `POST /v1/admin/project-partners` — list one partner on one project.
 *
 * `isPrimary` defaults to FALSE rather than being required: adding a partner is
 * the common act, and making it THE primary is the deliberate one. A create that
 * asks for `isPrimary: true` while an active primary already exists is refused
 * with 409 `RELATIONSHIP_CONFLICT` and zero mutation — the flag is MOVED by a
 * PATCH, never won by a race against the index.
 */
export const CreateProjectPartnerRequestSchema = z
  .object({
    projectId: TaxonomyIdSchema,
    partnerId: TaxonomyIdSchema,
    isPrimary: z.boolean().default(false),
  })
  .strict();
export type CreateProjectPartnerRequest = z.infer<
  typeof CreateProjectPartnerRequestSchema
>;

/**
 * `PATCH /v1/admin/project-partners/:id` — edit the SAME row's `isPrimary`.
 * Omission means unchanged. Setting it true while another ACTIVE row of the same
 * project holds it is 409 `RELATIONSHIP_CONFLICT`: the operator clears the
 * incumbent first, so «who is the primary partner» is never decided by whichever
 * request happened to reach the index first.
 */
export const UpdateProjectPartnerRequestSchema = z
  .object({
    isPrimary: z.boolean().optional(),
  })
  .strict();
export type UpdateProjectPartnerRequest = z.infer<
  typeof UpdateProjectPartnerRequestSchema
>;

/** The admin projection of one project↔partner relation. */
export const ProjectPartnerAdminDetailSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectTitle: z.string(),
  projectSlug: z.string(),
  partnerId: z.string(),
  partnerTitle: z.string(),
  partnerSlug: z.string(),
  isPrimary: z.boolean(),
  status: RelationshipStatusSchema,
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectPartnerAdminDetail = z.infer<
  typeof ProjectPartnerAdminDetailSchema
>;

/** Offset/page admin list envelope (ADR-0002 — admin pagination is offset-based). */
export const ProjectPartnerAdminListSchema = z.object({
  data: z.array(ProjectPartnerAdminDetailSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ProjectPartnerAdminList = z.infer<
  typeof ProjectPartnerAdminListSchema
>;

/** Either endpoint may scope the list — one route serves both panel directions. */
export const ProjectPartnerAdminListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .max(ADMIN_LIST_PAGE_SIZE_MAX)
      .default(ADMIN_LIST_PAGE_SIZE_DEFAULT),
    projectId: TaxonomyIdSchema.optional(),
    partnerId: TaxonomyIdSchema.optional(),
    isPrimary: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .transform((v) => v === true || v === "true")
      .optional(),
    status: RelationshipStatusSchema.optional(),
    includeRetired: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .transform((v) => v === true || v === "true")
      .default(false),
  })
  .strict();
export type ProjectPartnerAdminListQuery = z.infer<
  typeof ProjectPartnerAdminListQuerySchema
>;

// ── Admin list query (012-design §5.1; the shell #1297 later sweeps) ─────────

/**
 * The shared admin list query of every taxonomy resource. `includeRetired`
 * defaults to FALSE: a retired row is filtered out of default reads rather than
 * deleted, so the default list is the operator's working set and the toggle is
 * an explicit act.
 */
export const AdminTaxonomyListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .max(ADMIN_LIST_PAGE_SIZE_MAX)
      .default(ADMIN_LIST_PAGE_SIZE_DEFAULT),
    /** Case-insensitive substring over title/slug. */
    q: z.string().trim().max(160).optional(),
    status: TaxonomyStatusSchema.optional(),
    includeRetired: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .transform((v) => v === true || v === "true")
      .default(false),
  })
  .strict();
export type AdminTaxonomyListQuery = z.infer<
  typeof AdminTaxonomyListQuerySchema
>;

/**
 * The join admin list query (012-design §5.1 "filtered list"). It is the shared
 * entity query minus `q` — a relationship has no title to search — plus the two
 * endpoint filters the Refine relation tables actually use.
 */
export const AdminEventExpertListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .max(ADMIN_LIST_PAGE_SIZE_MAX)
      .default(ADMIN_LIST_PAGE_SIZE_DEFAULT),
    eventId: TaxonomyIdSchema.optional(),
    expertId: TaxonomyIdSchema.optional(),
    status: RelationshipStatusSchema.optional(),
    includeRetired: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .transform((v) => v === true || v === "true")
      .default(false),
  })
  .strict();
export type AdminEventExpertListQuery = z.infer<
  typeof AdminEventExpertListQuerySchema
>;

// ── Errors (012-design §5.3) ─────────────────────────────────────────────────

/**
 * The exact stable `errorCode` set of the admin problem surface (012-design §5.3
 * table, EARS-16; 014-design §11). One flat closed union rather than per-status
 * enums: a client switches on the code, and the code is the contract — the HTTP
 * status is the transport-level echo of it.
 *
 * 014 (#1339) extends the union rather than opening a second one. The RFC 7807
 * machinery — `TaxonomyError`, `TaxonomyProblemFilter`, the status/title tables
 * and the fenced deterministic-replay classification — is ONE mechanism shared by
 * every retained-row admin surface; a parallel union would mean a parallel filter,
 * a parallel status table and two answers to «what does this code mean».
 */
export const TAXONOMY_ERROR_CODES = [
  // 400
  "VALIDATION_FAILED",
  "MEDIA_INVALID",
  "MEDIA_INPUT_CONFLICT",
  "CURSOR_INVALID",
  "IDEMPOTENCY_KEY_INVALID",
  // 401 / 403
  "ADMIN_SESSION_REQUIRED",
  "PLATFORM_ADMIN_REQUIRED",
  // 404
  "RESOURCE_NOT_FOUND",
  // 409
  "RELATIONSHIP_CONFLICT",
  "USER_EXPERT_CONFLICT",
  "SLUG_CONFLICT",
  "SLUG_IMMUTABLE",
  "PUBLISH_REQUIREMENTS_NOT_MET",
  "PUBLISHED_PROJECT_REQUIRES_CURATOR",
  "INVALID_TRANSITION",
  "SPEAKER_POSITION_OCCUPIED",
  "CONTENT_REMOVED",
  // 409 — 014 recordings (014-design §3/§11)
  "RECORDING_KIND_OCCUPIED",
  "EVENT_NOT_FINISHED",
  "IDEMPOTENCY_KEY_REUSED",
  "IDEMPOTENCY_REQUEST_IN_PROGRESS",
  // 412
  "PRECONDITION_FAILED",
  "LIFECYCLE_IMPACT_STALE",
  // 415
  "UNSUPPORTED_MEDIA_TYPE",
  // 428
  "IDEMPOTENCY_KEY_REQUIRED",
  "PRECONDITION_REQUIRED",
  "LIFECYCLE_IMPACT_REQUIRED",
  // 503
  "MEDIA_STORAGE_UNAVAILABLE",
] as const;
export const TaxonomyErrorCodeSchema = z.enum(TAXONOMY_ERROR_CODES);
export type TaxonomyErrorCode = z.infer<typeof TaxonomyErrorCodeSchema>;

/**
 * RFC 7807 Problem Details plus the two platform fields (012-design §5.3):
 * `errorCode` (the stable machine contract) and `traceId` (the operational
 * handle). No database key, storage key or hidden lifecycle state ever appears —
 * `errors` carries field-addressed validation detail only.
 */
export const ProblemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errorCode: TaxonomyErrorCodeSchema,
  traceId: z.string(),
  /** Field-addressed validation/publish-requirement detail, when applicable. */
  errors: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

// ── Idempotency protocol (012-design §6) ─────────────────────────────────────

/** Required on every mutating taxonomy endpoint. */
export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";
/** Optimistic-concurrency precondition on PATCH and every lifecycle command. */
export const IF_MATCH_HEADER = "if-match";
/** The retained-record window (012-design §6). */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * How long one request owns its record before an exact-input retry may take it
 * over by CAS-acquiring a newer `lease_epoch`. Bounded so a crashed owner cannot
 * park a key forever, and long enough that a legitimate slow upload is not
 * stolen mid-flight.
 */
export const IDEMPOTENCY_LEASE_MS = 60_000;

/**
 * Canonical lowercase UUID text, exactly (012-design §6). Uppercase or braced
 * forms are NON-canonical, not merely ugly: the key is the global reservation
 * identity, so accepting two spellings of one UUID would create two records for
 * one logical request. A non-canonical key is 400 `IDEMPOTENCY_KEY_INVALID`;
 * absent/blank is 428 `IDEMPOTENCY_KEY_REQUIRED`.
 */
export const IdempotencyKeySchema = z.string().regex(CANONICAL_UUID_REGEX);

/** Whether `raw` is a canonical lowercase UUID (the 400 vs 428 discriminator). */
export function isCanonicalIdempotencyKey(raw: string): boolean {
  return CANONICAL_UUID_REGEX.test(raw);
}

/** The admin ETag for a versioned taxonomy row — a weak validator over `version`. */
export function taxonomyETag(version: number): string {
  return `W/"${version}"`;
}

/**
 * Parse an `If-Match` header into the version it asserts, or `null` when it does
 * not name one. Accepts both the weak form this API issues and the bare integer,
 * because a client that echoes what it received must always succeed.
 */
export function parseIfMatchVersion(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = /^(?:W\/)?"?(\d+)"?$/.exec(raw.trim());
  if (!match) return null;
  const version = Number(match[1]);
  return Number.isSafeInteger(version) && version > 0 ? version : null;
}

// ── ADR-0016 §2.8 — the direction reference relations (#1483) ───────────────
//
// Two admin-authored link surfaces on top of the renamed `directions` book:
// which Минздрав specialties a direction serves, and which other directions are
// adjacent to it. 017 EARS-8 resolves a doctor's `TargetingSet` from exactly
// these rows, so both bodies are `.strict()` for the same reason the 012 joins
// are: a client must never be able to post `status`, `version` or `deletedAt` —
// lifecycle moves through the retire/restore commands, never through a payload.

/**
 * `POST /v1/admin/direction-specialties` — state that a direction serves one
 * entry of the closed Минздрав book.
 *
 * The body is the two endpoint ids and nothing else: the link carries no
 * attribute of its own, so, exactly as with `event_projects`, there is no PATCH
 * counterpart — a PATCH here could only accept an empty body and bump a version.
 */
export const CreateDirectionSpecialtyRequestSchema = z
  .object({
    directionId: TaxonomyIdSchema,
    specialtyMinzdravId: TaxonomyIdSchema,
  })
  .strict();
export type CreateDirectionSpecialtyRequest = z.infer<
  typeof CreateDirectionSpecialtyRequestSchema
>;

/**
 * The admin projection of one direction↔specialty link. Both endpoints' display
 * forms ride along (`directionTitle`, `specialtyName`) because the editor
 * renders a LIST of links — a table of two opaque UUIDs would force one
 * follow-up read per row.
 */
export const DirectionSpecialtyAdminDetailSchema = z.object({
  id: z.string(),
  directionId: z.string(),
  directionTitle: z.string(),
  directionSlug: z.string(),
  specialtyMinzdravId: z.string(),
  specialtyCode: z.string(),
  specialtyName: z.string(),
  status: RelationshipStatusSchema,
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DirectionSpecialtyAdminDetail = z.infer<
  typeof DirectionSpecialtyAdminDetailSchema
>;

/** Offset/page admin list envelope (ADR-0002 — admin pagination is offset-based). */
export const DirectionSpecialtyAdminListSchema = z.object({
  data: z.array(DirectionSpecialtyAdminDetailSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type DirectionSpecialtyAdminList = z.infer<
  typeof DirectionSpecialtyAdminListSchema
>;

/**
 * Either endpoint may scope the list — that is how the admin renders
 * «специальности этого направления» and «направления этой специальности» from
 * one route — and retired links are excluded unless explicitly asked for.
 */
export const DirectionSpecialtyAdminListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .max(ADMIN_LIST_PAGE_SIZE_MAX)
      .default(ADMIN_LIST_PAGE_SIZE_DEFAULT),
    directionId: TaxonomyIdSchema.optional(),
    specialtyMinzdravId: TaxonomyIdSchema.optional(),
    status: RelationshipStatusSchema.optional(),
    includeRetired: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .transform((v) => v === true || v === "true")
      .default(false),
  })
  .strict();
export type DirectionSpecialtyAdminListQuery = z.infer<
  typeof DirectionSpecialtyAdminListQuerySchema
>;

/**
 * The adjacency edge label — a CLOSED vocabulary (017-design §9.3), mirroring
 * the `direction_adjacency_kind` enum in `@ds/db`: the type owns the constraint,
 * this schema owns the wire contract, and the SDK regenerates from it. A value
 * outside the set is a 400 with a field path, never a 500 from the type cast.
 *
 * The stored values are machine slugs; the RU labels an operator reads
 * («Смежное направление» / «Поддисциплина» / «Междисциплинарная связь») are
 * presentation and live with the admin surface, not in the contract.
 */
export const DIRECTION_ADJACENCY_KINDS = [
  "related",
  "subdiscipline",
  "interdisciplinary",
] as const;
export const DirectionAdjacencyKindSchema = z.enum(DIRECTION_ADJACENCY_KINDS);
export type DirectionAdjacencyKind = z.infer<
  typeof DirectionAdjacencyKindSchema
>;

export const DIRECTION_ADJACENCY_WEIGHT_MIN = 1;
export const DIRECTION_ADJACENCY_WEIGHT_MAX = 100;

const DirectionAdjacencyWeightSchema = z.coerce
  .number()
  .int()
  .min(DIRECTION_ADJACENCY_WEIGHT_MIN)
  .max(DIRECTION_ADJACENCY_WEIGHT_MAX);

/**
 * `POST /v1/admin/direction-adjacency` — author one DIRECTED adjacency edge.
 *
 * The edge is directed by design (see `direction_adjacency` in `@ds/db`): a
 * mutual relation is two authored rows, never one row read both ways, because
 * 017 EARS-8 admits nothing into a `TargetingSet` that an operator did not
 * author. The self-edge refusal is stated here as well as in the DB CHECK so the
 * operator gets a 400 with a field path rather than a 500 from a constraint.
 */
export const CreateDirectionAdjacencyRequestSchema = z
  .object({
    directionId: TaxonomyIdSchema,
    adjacentDirectionId: TaxonomyIdSchema,
    kind: DirectionAdjacencyKindSchema,
    // Optional, and absent from the operator interface: weight is a tuning
    // parameter of targeting resolution, so the column's declared default
    // applies unless a caller states otherwise (017-design §9.3).
    weight: DirectionAdjacencyWeightSchema.optional(),
  })
  .strict()
  .refine((v) => v.directionId !== v.adjacentDirectionId, {
    path: ["adjacentDirectionId"],
    message: "a direction is never adjacent to itself",
  });
export type CreateDirectionAdjacencyRequest = z.infer<
  typeof CreateDirectionAdjacencyRequestSchema
>;

/**
 * `PATCH /v1/admin/direction-adjacency/:id` — re-label or re-weight the SAME
 * edge. Unlike the two joins of 012 this relation DOES carry attributes, so the
 * PATCH surface is not vacuous; the endpoints themselves are the edge's identity
 * and are therefore not patchable — moving an edge is retiring one and
 * authoring another.
 */
export const UpdateDirectionAdjacencyRequestSchema = z
  .object({
    kind: DirectionAdjacencyKindSchema.optional(),
    weight: DirectionAdjacencyWeightSchema.optional(),
  })
  .strict();
export type UpdateDirectionAdjacencyRequest = z.infer<
  typeof UpdateDirectionAdjacencyRequestSchema
>;

/** The admin projection of one adjacency edge, both endpoints readable. */
export const DirectionAdjacencyAdminDetailSchema = z.object({
  id: z.string(),
  directionId: z.string(),
  directionTitle: z.string(),
  directionSlug: z.string(),
  adjacentDirectionId: z.string(),
  adjacentDirectionTitle: z.string(),
  adjacentDirectionSlug: z.string(),
  kind: DirectionAdjacencyKindSchema,
  weight: z.number().int(),
  status: RelationshipStatusSchema,
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DirectionAdjacencyAdminDetail = z.infer<
  typeof DirectionAdjacencyAdminDetailSchema
>;

/** Offset/page admin list envelope (ADR-0002 — admin pagination is offset-based). */
export const DirectionAdjacencyAdminListSchema = z.object({
  data: z.array(DirectionAdjacencyAdminDetailSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type DirectionAdjacencyAdminList = z.infer<
  typeof DirectionAdjacencyAdminListSchema
>;

/**
 * Either END of the edge may scope the list: `directionId` answers «что рядом с
 * этим направлением», `adjacentDirectionId` answers «кто считает это
 * направление смежным» — the reverse question a directed edge makes askable.
 */
export const DirectionAdjacencyAdminListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .max(ADMIN_LIST_PAGE_SIZE_MAX)
      .default(ADMIN_LIST_PAGE_SIZE_DEFAULT),
    directionId: TaxonomyIdSchema.optional(),
    adjacentDirectionId: TaxonomyIdSchema.optional(),
    kind: DirectionAdjacencyKindSchema.optional(),
    status: RelationshipStatusSchema.optional(),
    includeRetired: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .transform((v) => v === true || v === "true")
      .default(false),
  })
  .strict();
export type DirectionAdjacencyAdminListQuery = z.infer<
  typeof DirectionAdjacencyAdminListQuerySchema
>;

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
export const SLUG_MAX = 160;

/**
 * A client-authored slug. Rejects both the wrong grammar and the id namespace
 * (012-design §2.1): a slug that parses as a canonical UUID would make
 * `/:idOrSlug` ambiguous, so it is a 400 before any row is written — never
 * silently rewritten into something else.
 */
export const SlugSchema = z
  .string()
  .min(1)
  .max(SLUG_MAX)
  .regex(SLUG_REGEX, "slug must be lowercase-ASCII words joined by single hyphens")
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
 * publish-required and may stay null on a draft; `slug` is optional and
 * server-generated from the title when omitted.
 */
export const CreateProjectRequestSchema = z
  .object({
    kind: ProjectKindSchema,
    title: ProjectTitleSchema,
    description: ProjectDescriptionSchema.nullish(),
    slug: SlugSchema.optional(),
  })
  .strict();
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

/**
 * `PATCH /v1/admin/projects/:id` — edit the same row.
 *
 * Omission means unchanged; an explicit `null` clears an optional or
 * still-incomplete draft field (012-design §2.2). `slug` is accepted only while
 * `first_published_at IS NULL` — the server refuses a later change with 409
 * `SLUG_IMMUTABLE` rather than validating it away here, because the refusal
 * depends on row state, not on request shape.
 */
export const UpdateProjectRequestSchema = z
  .object({
    kind: ProjectKindSchema.optional(),
    title: ProjectTitleSchema.optional(),
    description: ProjectDescriptionSchema.nullish(),
    slug: SlugSchema.optional(),
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
  slug: z.string(),
  kind: ProjectKindSchema,
  title: z.string(),
  description: z.string().nullable(),
  coverUrl: z.string().nullable(),
  status: TaxonomyStatusSchema,
  /** Null until the first publish; once set, the slug is permanently locked. */
  firstPublishedAt: z.string().nullable(),
  /** True iff the slug may still be edited — the UI reads this, never re-derives it. */
  slugEditable: z.boolean(),
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

export const EXPERT_NAME_MIN = 1;
export const EXPERT_NAME_MAX = 160;
export const EXPERT_PROFESSIONAL_ROLE_MIN = 1;
export const EXPERT_PROFESSIONAL_ROLE_MAX = 160;
export const EXPERT_CREDENTIALS_MIN = 1;
export const EXPERT_CREDENTIALS_MAX = 500;
export const EXPERT_AFFILIATION_MIN = 1;
export const EXPERT_AFFILIATION_MAX = 240;
export const EXPERT_BIO_MIN = 1;
export const EXPERT_BIO_MAX = 4000;

const ExpertNameSchema = z
  .string()
  .trim()
  .min(EXPERT_NAME_MIN)
  .max(EXPERT_NAME_MAX);
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
 * `name` is the required display identity (§2.2 — display labels are required
 * on create); every other public field is publish-required and may stay null
 * while the row is a draft. An expert has NO required platform-user link: there
 * is no `userId` field to supply, by design (EARS-2).
 */
export const CreateExpertRequestSchema = z
  .object({
    name: ExpertNameSchema,
    professionalRole: ExpertProfessionalRoleSchema.nullish(),
    credentials: ExpertCredentialsSchema.nullish(),
    affiliation: ExpertAffiliationSchema.nullish(),
    bio: ExpertBioSchema.nullish(),
    slug: SlugSchema.optional(),
  })
  .strict();
export type CreateExpertRequest = z.infer<typeof CreateExpertRequestSchema>;

/**
 * `PATCH /v1/admin/experts/:id` — edit the same row.
 *
 * Omission means unchanged; an explicit `null` clears an optional or
 * still-incomplete draft field (012-design §2.2). `name` accepts no null: the
 * display label is only ever removed by §2.4's editorial removal (#1306), never
 * by an ordinary edit. `slug` is accepted only while `first_published_at IS
 * NULL` — the refusal depends on row state, so it is a 409 `SLUG_IMMUTABLE`
 * from the service, not a shape rule here.
 */
export const UpdateExpertRequestSchema = z
  .object({
    name: ExpertNameSchema.optional(),
    professionalRole: ExpertProfessionalRoleSchema.nullish(),
    credentials: ExpertCredentialsSchema.nullish(),
    affiliation: ExpertAffiliationSchema.nullish(),
    bio: ExpertBioSchema.nullish(),
    slug: SlugSchema.optional(),
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
  slug: z.string(),
  /** Null only on an editorially removed row (#1306); the admin then labels it «[удалён]». */
  name: z.string().nullable(),
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
  /** True iff the slug may still be edited — the UI reads this, never re-derives it. */
  slugEditable: z.boolean(),
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

// ── Topic authoring DTOs (012-design §2.2 matrix; EARS-3, #1285) ────────────

export const TOPIC_TITLE_MIN = 1;
export const TOPIC_TITLE_MAX = 120;

const TopicTitleSchema = z
  .string()
  .trim()
  .min(TOPIC_TITLE_MIN)
  .max(TOPIC_TITLE_MAX);

/**
 * `POST /v1/admin/topics` — create one draft topic.
 *
 * The thinnest create body of the four entities: a topic is a title plus its
 * permanent public identity (§2 ER; §5.2 `PublicTopic { id, slug, title }`).
 * There is no description and no media, so this request is always
 * `application/json` (§5.1) and carries no `mediaAction`.
 *
 * `.strict()` is load-bearing here for a different reason than it is for a
 * project or an expert: there is no media reference to smuggle in, but a client
 * that posts `description` or `coverRef` is asking for a topic shape this
 * feature deliberately does NOT have — a silently ignored field would let the
 * admin believe it stored something. 400 `VALIDATION_FAILED` instead.
 */
export const CreateTopicRequestSchema = z
  .object({
    title: TopicTitleSchema,
    slug: SlugSchema.optional(),
  })
  .strict();
export type CreateTopicRequest = z.infer<typeof CreateTopicRequestSchema>;

/**
 * `PATCH /v1/admin/topics/:id` — edit the same row.
 *
 * Omission means unchanged. Neither field accepts `null`: `title` is the row's
 * only descriptive value and NOT NULL in the DB, and `slug` is the permanent
 * identity. `slug` is accepted only while `first_published_at IS NULL` — the
 * refusal depends on row state, so it is a 409 `SLUG_IMMUTABLE` from the
 * service, not a shape rule here.
 */
export const UpdateTopicRequestSchema = z
  .object({
    title: TopicTitleSchema.optional(),
    slug: SlugSchema.optional(),
  })
  .strict();
export type UpdateTopicRequest = z.infer<typeof UpdateTopicRequestSchema>;

/**
 * The admin detail projection. `version` backs the ETag the next PATCH must
 * echo; `slugEditable` is the server's answer to "may the operator still change
 * the public URL", which the UI reads rather than re-deriving.
 */
export const TopicAdminDetailSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  status: TaxonomyStatusSchema,
  /** Null until the first publish; once set, the slug is permanently locked. */
  firstPublishedAt: z.string().nullable(),
  /** True iff the slug may still be edited — the UI reads this, never re-derives it. */
  slugEditable: z.boolean(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TopicAdminDetail = z.infer<typeof TopicAdminDetailSchema>;

/** One row of the admin list — the columns the table renders, nothing more. */
export const TopicAdminListItemSchema = TopicAdminDetailSchema.pick({
  id: true,
  slug: true,
  title: true,
  status: true,
  version: true,
  updatedAt: true,
});
export type TopicAdminListItem = z.infer<typeof TopicAdminListItemSchema>;

/** Offset/page admin list envelope (ADR-0002 — admin pagination is offset-based). */
export const TopicAdminListSchema = z.object({
  data: z.array(TopicAdminListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type TopicAdminList = z.infer<typeof TopicAdminListSchema>;

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
  .regex(PARTNER_WEBSITE_URL_PATTERN, "website must be an absolute https:// URL");

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
    slug: SlugSchema.optional(),
  })
  .strict();
export type CreatePartnerRequest = z.infer<typeof CreatePartnerRequestSchema>;

/**
 * `PATCH /v1/admin/partners/:id` — edit the same row.
 *
 * Omission means unchanged; an explicit `null` clears the optional website.
 * `title` accepts no null: it is the row's display identity and NOT NULL in the
 * DB. `slug` is accepted only while `first_published_at IS NULL` — the refusal
 * depends on row state, so it is a 409 `SLUG_IMMUTABLE` from the service, not a
 * shape rule here. `mediaAction: "clear"` drops the logo.
 */
export const UpdatePartnerRequestSchema = z
  .object({
    title: PartnerTitleSchema.optional(),
    websiteUrl: PartnerWebsiteUrlSchema.nullish(),
    slug: SlugSchema.optional(),
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
  slug: z.string(),
  title: z.string(),
  logoUrl: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  status: TaxonomyStatusSchema,
  /** Null until the first publish; once set, the slug is permanently locked. */
  firstPublishedAt: z.string().nullable(),
  /** True iff the slug may still be edited — the UI reads this, never re-derives it. */
  slugEditable: z.boolean(),
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
 * `legacySpeakerId` is the EXPLICIT match and the only way a link ever acquires
 * one: there is no name field here, because the command never infers a match
 * from a name. Omitting it creates an unpaired link, which is a different
 * outcome, not a degraded one.
 */
export const CreateEventExpertRequestSchema = z
  .object({
    eventId: TaxonomyIdSchema,
    expertId: TaxonomyIdSchema,
    role: EventExpertRoleSchema,
    position: EventExpertPositionSchema,
    legacySpeakerId: TaxonomyIdSchema.nullish(),
  })
  .strict();
export type CreateEventExpertRequest = z.infer<
  typeof CreateEventExpertRequestSchema
>;

/**
 * `PATCH /v1/admin/event-experts/:id` — edit the SAME row. Omission means
 * unchanged; an explicit `null` on `legacySpeakerId` UNMATCHES the link, which
 * is a deliberate editorial act (the suppressed legacy row becomes visible
 * again) and therefore distinguishable from omission.
 *
 * Neither endpoint is patchable: re-pointing a link at another event or another
 * expert would silently rewrite history on a row the audit ledger already
 * attributes. That is a retire plus a new link.
 */
export const UpdateEventExpertRequestSchema = z
  .object({
    role: EventExpertRoleSchema.optional(),
    position: EventExpertPositionSchema.optional(),
    legacySpeakerId: TaxonomyIdSchema.nullable().optional(),
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
  legacySpeakerId: TaxonomyIdSchema.nullable(),
  status: RelationshipStatusSchema,
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EventExpertAdminDetail = z.infer<
  typeof EventExpertAdminDetailSchema
>;

export const EventExpertAdminListItemSchema = EventExpertAdminDetailSchema.pick({
  id: true,
  eventId: true,
  expertId: true,
  role: true,
  position: true,
  legacySpeakerId: true,
  status: true,
  version: true,
  updatedAt: true,
});
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

// ── Admin list query (012-design §5.1; the shell #1297 later sweeps) ─────────

export const ADMIN_LIST_PAGE_SIZE_DEFAULT = 20;
export const ADMIN_LIST_PAGE_SIZE_MAX = 100;

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
  "SLUG_CONFLICT",
  "SLUG_IMMUTABLE",
  "PUBLISH_REQUIREMENTS_NOT_MET",
  "PUBLISHED_PROJECT_REQUIRES_CURATOR",
  "INVALID_TRANSITION",
  "LEGACY_SPEAKER_CONFLICT",
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
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
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

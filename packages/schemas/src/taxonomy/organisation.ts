import { z } from "zod";

import { OrganisationRoleRefSchema } from "./organisation-role.js";
import {
  MediaActionSchema,
  SlugSchema,
  TaxonomyIdSchema,
  TaxonomyStatusSchema,
} from "./taxonomy.schema.js";

// 032 — the organisation registry contract (032-design §Placement): the
// feature-012 partner authoring DTOs (012-design §2.2 matrix; EARS-4, #1286)
// renamed, plus the 032 EARS-1 description and display rules and the EARS-2
// role set. The PUBLIC partner DTOs (`PublicPartnerSummary` and the relation
// items) keep their names and shapes in `taxonomy.schema.ts` (EARS-5).


export const ORGANISATION_TITLE_MIN = 1;
export const ORGANISATION_TITLE_MAX = 160;
export const ORGANISATION_WEBSITE_URL_MAX = 2048;

const OrganisationTitleSchema = z
  .string()
  .trim()
  .min(ORGANISATION_TITLE_MIN)
  .max(ORGANISATION_TITLE_MAX);

/**
 * An absolute HTTPS organisation website (012-design §2.2 — "optional absolute HTTPS
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
 * pattern is the DB CHECK `organisations_website_url_https` (migration 0019, renamed by 0054), so the
 * contract edge and the column enforce ONE rule instead of two validators that
 * can drift apart; `organisations-schema.e2e-spec.ts` proves the column agrees.
 */
export const ORGANISATION_WEBSITE_URL_PATTERN = /^https:\/\/[^\s/?#]+[^\s]*$/;

export const OrganisationWebsiteUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(ORGANISATION_WEBSITE_URL_MAX)
  .regex(
    ORGANISATION_WEBSITE_URL_PATTERN,
    "website must be an absolute https:// URL",
  );

export const ORGANISATION_DESCRIPTION_MAX = 1000;

/** EARS-1 — optional plain text, trimmed, 0–1000. An empty value clears it. */
export const OrganisationDescriptionSchema = z
  .string()
  .trim()
  .max(ORGANISATION_DESCRIPTION_MAX);

/**
 * EARS-2 — the role set: canonical role ids, each at most once. Whether an id
 * names an active role (or one the organisation already holds) is a server
 * check against the reference book, field-addressed to `roleIds`.
 */
export const OrganisationRoleIdsSchema = z
  .array(TaxonomyIdSchema)
  .max(64)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "a role may be listed only once",
  });

/**
 * `POST /v1/admin/organisations` — create one draft organisation.
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
export const CreateOrganisationRequestSchema = z
  .object({
    title: OrganisationTitleSchema,
    websiteUrl: OrganisationWebsiteUrlSchema.nullish(),
    description: OrganisationDescriptionSchema.nullish(),
    /** EARS-2 — the role set; absent or empty is allowed while the row is a draft. */
    roleIds: OrganisationRoleIdsSchema.optional(),
    /** EARS-1 — «Показывать название публично»; absent means on. */
    publicNameVisible: z.boolean().optional(),
    /** EARS-1 — «Показывать логотип публично»; absent means on. */
    publicLogoVisible: z.boolean().optional(),
  })
  .strict();
export type CreateOrganisationRequest = z.infer<typeof CreateOrganisationRequestSchema>;

/**
 * `PATCH /v1/admin/organisations/:id` — edit the same row.
 *
 * Omission means unchanged; an explicit `null` clears the optional website.
 * `title` accepts no null: it is the row's display identity and NOT NULL in the
 * DB. Slug is absent because its stable public identity is generated and
 * retained by the server. `mediaAction: "clear"` drops the logo.
 */
export const UpdateOrganisationRequestSchema = z
  .object({
    title: OrganisationTitleSchema.optional(),
    websiteUrl: OrganisationWebsiteUrlSchema.nullish(),
    description: OrganisationDescriptionSchema.nullish(),
    /** EARS-2 — present replaces the whole set; absent leaves it unchanged. */
    roleIds: OrganisationRoleIdsSchema.optional(),
    publicNameVisible: z.boolean().optional(),
    publicLogoVisible: z.boolean().optional(),
    mediaAction: MediaActionSchema.optional(),
  })
  .strict();
export type UpdateOrganisationRequest = z.infer<typeof UpdateOrganisationRequestSchema>;

/**
 * The admin detail projection. `logoUrl` is a server-issued signed/CDN URL
 * derived from the stored key at read time — the key itself never crosses the
 * wire (012-design §5.1). `version` backs the ETag the next PATCH must echo.
 */
export const OrganisationAdminDetailSchema = z.object({
  id: z.string(),
  slug: SlugSchema,
  title: z.string(),
  logoUrl: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  description: z.string().nullable(),
  publicNameVisible: z.boolean(),
  publicLogoVisible: z.boolean(),
  /** EARS-2 — every held role, a retired one included (shown «Роль снята»). */
  roles: z.array(OrganisationRoleRefSchema),
  status: TaxonomyStatusSchema,
  /** Null until the first publish; once set, the slug is permanently locked. */
  firstPublishedAt: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OrganisationAdminDetail = z.infer<typeof OrganisationAdminDetailSchema>;

/** One row of the admin list — the columns the table renders, nothing more. */
export const OrganisationAdminListItemSchema = OrganisationAdminDetailSchema.pick({
  id: true,
  slug: true,
  title: true,
  websiteUrl: true,
  roles: true,
  status: true,
  version: true,
  updatedAt: true,
});
export type OrganisationAdminListItem = z.infer<typeof OrganisationAdminListItemSchema>;

/** Offset/page admin list envelope (ADR-0002 — admin pagination is offset-based). */
export const OrganisationAdminListSchema = z.object({
  data: z.array(OrganisationAdminListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type OrganisationAdminList = z.infer<typeof OrganisationAdminListSchema>;

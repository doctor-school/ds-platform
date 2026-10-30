import { z } from "zod";

import {
  ADMIN_LIST_PAGE_SIZE_DEFAULT,
  ADMIN_LIST_PAGE_SIZE_MAX,
  SlugSchema,
  TaxonomyIdSchema,
  TaxonomyStatusSchema,
} from "../taxonomy/taxonomy.schema.js";
import {
  bodyText,
  type MaterialBody,
  materialBodySchema,
} from "./material-body.js";

// 048 (#3512) — the material authoring contract (048-design §Data model,
// §Endpoints; EARS-1, EARS-4…EARS-8, EARS-19). The body document itself is the
// EARS-2 contract of `material-body.ts`; this module carries the fields around
// it, the admin projections and the EARS-4 publish requirement set.

export const MATERIAL_TITLE_MIN = 1;
export const MATERIAL_TITLE_MAX = 160;
export const MATERIAL_AUTHOR_LINE_MAX = 120;

/** EARS-1 — «Новость» (`news`) / «Колонка эксперта» (`column`). */
export const MaterialKindSchema = z.enum(["news", "column"]);
export type MaterialKind = z.infer<typeof MaterialKindSchema>;

/** Lead decision 5 — an unpublished material is a draft again. */
export const MaterialStatusSchema = z.enum(["draft", "published"]);
export type MaterialStatus = z.infer<typeof MaterialStatusSchema>;

const MaterialTitleSchema = z
  .string()
  .trim()
  .min(MATERIAL_TITLE_MIN)
  .max(MATERIAL_TITLE_MAX);

/** EARS-1 — a news item's optional plain-text «Автор», trimmed 0–120. */
const MaterialAuthorLineSchema = z
  .string()
  .trim()
  .max(MATERIAL_AUTHOR_LINE_MAX);

const fields = {
  title: MaterialTitleSchema,
  authorLine: MaterialAuthorLineSchema.optional(),
  /** EARS-1 — a column's expert, from the non-retired 012 directory. */
  expertId: TaxonomyIdSchema.nullish(),
  /** EARS-19 — the optional 032 partner; `null` clears it. */
  partnerOrganisationId: TaxonomyIdSchema.nullish(),
  /** EARS-2 — the allowlisted ProseMirror document. */
  body: materialBodySchema.optional(),
};

/**
 * EARS-1 — the kind-dependent author: a column names its expert, a news item
 * names none. Applied wherever the merged state is known (create here; the
 * PATCH merge in the service, which reuses {@link materialAuthorIssues}).
 */
export function materialAuthorIssues(input: {
  kind: MaterialKind;
  expertId?: string | null | undefined;
}): { path: string; message: string }[] {
  if (input.kind === "column" && !input.expertId) {
    return [{ path: "expertId", message: "a column needs its expert" }];
  }
  if (input.kind === "news" && input.expertId) {
    return [
      {
        path: "expertId",
        message: "a news item has an author line, not an expert",
      },
    ];
  }
  return [];
}

/**
 * `POST /v1/admin/materials` — create one draft material. `.strict()`: a
 * client never supplies a slug, a status or a storage reference. An absent
 * body is the empty document a new editor holds.
 */
export const CreateMaterialRequestSchema = z
  .object({ kind: MaterialKindSchema, ...fields })
  .strict()
  .superRefine((value, ctx) => {
    for (const issue of materialAuthorIssues(value)) {
      ctx.addIssue({
        code: "custom",
        path: [issue.path],
        message: issue.message,
      });
    }
  });
export type CreateMaterialRequest = z.infer<typeof CreateMaterialRequestSchema>;

/**
 * `PATCH /v1/admin/materials/:id` — edit the same row; omission means
 * unchanged. The kind-dependent author rule is checked on the MERGED state by
 * the service, since a PATCH may change the kind or the expert alone.
 */
export const UpdateMaterialRequestSchema = z
  .object({
    kind: MaterialKindSchema.optional(),
    title: MaterialTitleSchema.optional(),
    authorLine: fields.authorLine,
    expertId: fields.expertId,
    partnerOrganisationId: fields.partnerOrganisationId,
    body: fields.body,
  })
  .strict();
export type UpdateMaterialRequest = z.infer<typeof UpdateMaterialRequestSchema>;

/**
 * EARS-4 / EARS-5 — the publish requirement set, each missing item named by
 * the form field it addresses: the title, a body with at least one character
 * of text and, for a column, a published expert. `expertPublished: null`
 * leaves the expert out — an edit of a published material does not re-check
 * it (EARS-5, Lead decision 11).
 */
export function materialPublishMissing(input: {
  kind: MaterialKind;
  title: string;
  body: MaterialBody;
  expertPublished: boolean | null;
}): { path: string; message: string }[] {
  const missing: { path: string; message: string }[] = [];
  if (input.title.trim().length === 0) {
    missing.push({
      path: "title",
      message: "a published material needs a title",
    });
  }
  if (bodyText(input.body).trim().length === 0) {
    missing.push({
      path: "body",
      message: "a published material needs body text",
    });
  }
  if (input.kind === "column" && input.expertPublished === false) {
    missing.push({
      path: "expertId",
      message: "a column is published only with a published expert",
    });
  }
  return missing;
}

/** A directory reference as the admin form shows it. */
export const MaterialExpertRefSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  status: TaxonomyStatusSchema,
});
export const MaterialPartnerRefSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: TaxonomyStatusSchema,
});

/** `GET /v1/admin/materials/:id` — the form's read; `version` backs the ETag. */
export const MaterialAdminDetailSchema = z.object({
  id: z.string(),
  slug: SlugSchema,
  kind: MaterialKindSchema,
  title: z.string(),
  authorLine: z.string(),
  expert: MaterialExpertRefSchema.nullable(),
  partner: MaterialPartnerRefSchema.nullable(),
  coverUrl: z.string().nullable(),
  body: materialBodySchema,
  status: MaterialStatusSchema,
  /** The card date; set once by the first publish (EARS-4, EARS-6). */
  firstPublishedAt: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MaterialAdminDetail = z.infer<typeof MaterialAdminDetailSchema>;

/**
 * EARS-7 — one row of «Материалы»: title, kind, status, first publication date
 * and author (the news author line or the column expert's display name).
 * `expertNotPublished` marks a published column whose expert is no longer
 * published — «Не на сайте: эксперт не опубликован».
 */
export const MaterialAdminListItemSchema = z.object({
  id: z.string(),
  slug: SlugSchema,
  kind: MaterialKindSchema,
  title: z.string(),
  status: MaterialStatusSchema,
  firstPublishedAt: z.string().nullable(),
  author: z.string().nullable(),
  expertNotPublished: z.boolean(),
  version: z.number().int().positive(),
  updatedAt: z.string(),
});
export type MaterialAdminListItem = z.infer<typeof MaterialAdminListItemSchema>;

export const MaterialAdminListSchema = z.object({
  data: z.array(MaterialAdminListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type MaterialAdminList = z.infer<typeof MaterialAdminListSchema>;

/** EARS-7 — search by title, filters by kind and status (012 EARS-23). */
export const AdminMaterialListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .max(ADMIN_LIST_PAGE_SIZE_MAX)
      .default(ADMIN_LIST_PAGE_SIZE_DEFAULT),
    q: z.string().trim().max(MATERIAL_TITLE_MAX).optional(),
    kind: MaterialKindSchema.optional(),
    status: MaterialStatusSchema.optional(),
  })
  .strict();
export type AdminMaterialListQuery = z.infer<
  typeof AdminMaterialListQuerySchema
>;

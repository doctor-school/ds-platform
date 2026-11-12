import { z } from "zod";
import { ProjectStageSchema, SlugSchema } from "./taxonomy.schema.js";

// 030 EARS-8 / EARS-9 / EARS-13 (#3505) — the public project reads of the
// Academy: the catalog, the scale line, the project page and its results.
//
// Every object is `.strict()`: the disclosure boundary, as on the 012 §5.2
// summaries. No project kind (030 makes a project's outputs its declared
// results), no status, storage key, row id of a result (results are replaced
// as a set, so their ids are not durable) or admin field reaches these reads.
// Optional values are PRESENT and nullable.

/** The investor of a catalog card, projected by 032 EARS-5. */
export const PublicProjectInvestorSchema = z
  .object({
    title: z.string(),
    /** `null` when the organisation's logo rule is off or it has no logo. */
    logoUrl: z.string().nullable(),
  })
  .strict();
export type PublicProjectInvestor = z.infer<typeof PublicProjectInvestorSchema>;

/** EARS-8 — one card of `GET /v1/public/projects`. */
export const PublicProjectCatalogItemSchema = z
  .object({
    slug: SlugSchema,
    title: z.string(),
    description: z.string().nullable(),
    coverUrl: z.string().nullable(),
    stage: ProjectStageSchema,
    stageNote: z.string().nullable(),
    /** Titles of the distinct kinds of the project's results, in result order. */
    outputs: z.array(z.string()),
    /** The «Инвестор проекта» link's organisation, or `null` (none, or not displayable). */
    investor: PublicProjectInvestorSchema.nullable(),
  })
  .strict();
export type PublicProjectCatalogItem = z.infer<
  typeof PublicProjectCatalogItemSchema
>;

/** EARS-8 — `GET /v1/public/projects`: active (running, soon) first, then completed, each in the operator's order. */
export const PublicProjectCatalogSchema = z
  .object({ data: z.array(PublicProjectCatalogItemSchema) })
  .strict();
export type PublicProjectCatalog = z.infer<typeof PublicProjectCatalogSchema>;

/** EARS-9 — `GET /v1/public/projects/scale`, computed per request. */
export const PublicProjectScaleSchema = z
  .object({
    projects: z.number().int().nonnegative(),
    /** The published-organisation count of 032 EARS-12 (`/v1/public/organisations/count`). */
    partners: z.number().int().nonnegative(),
    /** Distinct public events linked to a public project. */
    broadcasts: z.number().int().nonnegative(),
    /** Year of the earliest start among those events, `null` when there is none. */
    firstBroadcastYear: z.number().int().nullable(),
  })
  .strict();
export type PublicProjectScale = z.infer<typeof PublicProjectScaleSchema>;

/** EARS-13 — one organisation of the project page, projected by 032 EARS-5. */
export const PublicProjectOrganisationSchema = z
  .object({
    title: z.string(),
    logoUrl: z.string().nullable(),
    /** The title of the role the organisation plays in the project. */
    roleTitle: z.string(),
    note: z.string().nullable(),
    /** The «Инвестор проекта» mark. */
    isInvestor: z.boolean(),
  })
  .strict();
export type PublicProjectOrganisation = z.infer<
  typeof PublicProjectOrganisationSchema
>;

/** EARS-13 — `GET /v1/public/projects/{idOrSlug}`. */
export const PublicProjectSchema = z
  .object({
    slug: SlugSchema,
    title: z.string(),
    description: z.string().nullable(),
    coverUrl: z.string().nullable(),
    stage: ProjectStageSchema,
    stageNote: z.string().nullable(),
    /** The curator's public display name and nothing else of the curator. */
    curatorName: z.string().nullable(),
    resultCount: z.number().int().nonnegative(),
    /** Active links to published experts. */
    expertCount: z.number().int().nonnegative(),
    /** Year of the earliest public event start, else of the first publish. */
    sinceYear: z.number().int(),
    /** The investor first, then the other links by title. */
    organisations: z.array(PublicProjectOrganisationSchema),
    /** True only when the project has no active «Инвестор проекта» link. */
    investorPlaceOpen: z.boolean(),
  })
  .strict();
export type PublicProject = z.infer<typeof PublicProjectSchema>;

/** EARS-13 — one result of `GET /v1/public/projects/{idOrSlug}/results`. */
export const PublicProjectResultSchema = z
  .object({
    kindTitle: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    storefrontUrl: z.string().nullable(),
  })
  .strict();
export type PublicProjectResult = z.infer<typeof PublicProjectResultSchema>;

/** EARS-13 — the results in their order. */
export const PublicProjectResultListSchema = z
  .object({ data: z.array(PublicProjectResultSchema) })
  .strict();
export type PublicProjectResultList = z.infer<
  typeof PublicProjectResultListSchema
>;

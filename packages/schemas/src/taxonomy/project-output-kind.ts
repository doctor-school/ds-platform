import { z } from "zod";

import { SlugSchema, TaxonomyIdSchema } from "./taxonomy.schema.js";

// 030 EARS-2 / EARS-3 — the «Виды результатов» reference book and a project's
// ordered result set (030-design §Data model, §Endpoints). An output kind is an
// ordinary retained row: stable id, system-generated slug, version, and a title
// unique among ACTIVE kinds case-insensitively; retire is refused while a
// result of a draft or published project holds it (`409 OUTPUT_KIND_IN_USE`).
// A project's results are replaced as ONE set under the project's `If-Match`.

export const PROJECT_OUTPUT_KIND_TITLE_MIN = 1;
export const PROJECT_OUTPUT_KIND_TITLE_MAX = 60;

export const PROJECT_OUTPUT_KIND_STATUSES = ["active", "retired"] as const;
export const ProjectOutputKindStatusSchema = z.enum(
  PROJECT_OUTPUT_KIND_STATUSES,
);
export type ProjectOutputKindStatus = z.infer<
  typeof ProjectOutputKindStatusSchema
>;

const ProjectOutputKindTitleSchema = z
  .string()
  .trim()
  .min(PROJECT_OUTPUT_KIND_TITLE_MIN)
  .max(PROJECT_OUTPUT_KIND_TITLE_MAX);

/** `POST /v1/admin/project-output-kinds` — add a kind. The slug is the server's. */
export const CreateProjectOutputKindRequestSchema = z
  .object({ title: ProjectOutputKindTitleSchema })
  .strict();
export type CreateProjectOutputKindRequest = z.infer<
  typeof CreateProjectOutputKindRequestSchema
>;

/** `PATCH /v1/admin/project-output-kinds/:id` — rename, under `If-Match`. */
export const UpdateProjectOutputKindRequestSchema = z
  .object({ title: ProjectOutputKindTitleSchema })
  .strict();
export type UpdateProjectOutputKindRequest = z.infer<
  typeof UpdateProjectOutputKindRequestSchema
>;

/** A kind as a result carries it: a retired one is marked by its status («Вид снят»). */
export const ProjectOutputKindRefSchema = z.object({
  id: z.string(),
  slug: SlugSchema,
  title: z.string(),
  status: ProjectOutputKindStatusSchema,
});
export type ProjectOutputKindRef = z.infer<typeof ProjectOutputKindRefSchema>;

/** The admin projection of one kind, with the number of results of that kind. */
export const ProjectOutputKindAdminDetailSchema =
  ProjectOutputKindRefSchema.extend({
    /** Every result of the kind, whatever its project's status (030 EARS-3). */
    resultCount: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    createdAt: z.string(),
    updatedAt: z.string(),
  });
export type ProjectOutputKindAdminDetail = z.infer<
  typeof ProjectOutputKindAdminDetailSchema
>;

/** `GET /v1/admin/project-output-kinds` — a small book, one unpaged list ordered by title. */
export const ProjectOutputKindAdminListSchema = z.object({
  data: z.array(ProjectOutputKindAdminDetailSchema),
  total: z.number().int().nonnegative(),
});
export type ProjectOutputKindAdminList = z.infer<
  typeof ProjectOutputKindAdminListSchema
>;

/** `status=active` is what every results editor reads (EARS-3 «offer it at once»). */
export const ProjectOutputKindAdminListQuerySchema = z
  .object({ status: ProjectOutputKindStatusSchema.optional() })
  .strict();
export type ProjectOutputKindAdminListQuery = z.infer<
  typeof ProjectOutputKindAdminListQuerySchema
>;

/**
 * The field-error path prefix of `409 OUTPUT_KIND_IN_USE`: one entry per holding
 * draft or published project, `path` = `projects.<project id>`, `message` = its
 * title — the list the «Виды результатов» screen shows.
 */
export const OUTPUT_KIND_IN_USE_PATH_PREFIX = "projects.";

// ── a project's results (EARS-2) ─────────────────────────────────────────────

export const PROJECT_RESULTS_MAX = 20;
export const PROJECT_RESULT_TITLE_MIN = 1;
export const PROJECT_RESULT_TITLE_MAX = 120;
export const PROJECT_RESULT_DESCRIPTION_MAX = 300;
export const PROJECT_RESULT_URL_MAX = 2048;

/**
 * One result as the form sends it. `description` trims to empty ⇒ none.
 * `storefrontUrl` must be an absolute HTTPS URL; its ORIGIN is checked against
 * the configured doctor-storefront origin server-side (the API injects it), so
 * this schema owns only the shape.
 */
export const ProjectResultInputSchema = z
  .object({
    outputKindId: TaxonomyIdSchema,
    title: z
      .string()
      .trim()
      .min(PROJECT_RESULT_TITLE_MIN)
      .max(PROJECT_RESULT_TITLE_MAX),
    description: z
      .string()
      .trim()
      .max(PROJECT_RESULT_DESCRIPTION_MAX)
      .nullish()
      .transform((v) => (v ? v : null)),
    storefrontUrl: z
      .string()
      .trim()
      .max(PROJECT_RESULT_URL_MAX)
      .nullish()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || isAbsoluteHttpsUrl(v), {
        message: "the link must be an absolute https:// URL",
      }),
  })
  .strict();
export type ProjectResultInput = z.infer<typeof ProjectResultInputSchema>;

/** `PUT /v1/admin/projects/:id/results` — the whole ordered set, 0–20. */
export const ReplaceProjectResultsRequestSchema = z
  .object({
    results: z.array(ProjectResultInputSchema).max(PROJECT_RESULTS_MAX),
  })
  .strict();
export type ReplaceProjectResultsRequest = z.infer<
  typeof ReplaceProjectResultsRequestSchema
>;
export type ReplaceProjectResultsRequestInput = z.input<
  typeof ReplaceProjectResultsRequestSchema
>;

/** One stored result; a retired kind is shown marked «Вид снят» via `outputKind.status`. */
export const ProjectResultSchema = z.object({
  id: z.string(),
  position: z.number().int().nonnegative(),
  outputKind: ProjectOutputKindRefSchema,
  title: z.string(),
  description: z.string().nullable(),
  storefrontUrl: z.string().nullable(),
});
export type ProjectResult = z.infer<typeof ProjectResultSchema>;

/** `GET` / `PUT /v1/admin/projects/:id/results` — the set plus the project version (its ETag). */
export const ProjectResultsSchema = z.object({
  data: z.array(ProjectResultSchema),
  version: z.number().int().positive(),
});
export type ProjectResults = z.infer<typeof ProjectResultsSchema>;

const AbsoluteHttpsUrlSchema = z.url({
  protocol: /^https$/,
  hostname: z.regexes.domain,
});

function isAbsoluteHttpsUrl(value: string): boolean {
  return AbsoluteHttpsUrlSchema.safeParse(value).success;
}

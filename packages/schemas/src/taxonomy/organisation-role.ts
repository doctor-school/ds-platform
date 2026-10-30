import { z } from "zod";

import { SlugSchema } from "./taxonomy.schema.js";

// 032 EARS-3 — the organisation-role reference book contract (032-design
// §Data model, §Endpoints). A role is an ordinary retained row: stable id,
// system-generated slug, version, and a title unique among ACTIVE roles
// case-insensitively. Retire / restore (EARS-4) ride their own routes.

export const ORGANISATION_ROLE_TITLE_MIN = 1;
export const ORGANISATION_ROLE_TITLE_MAX = 80;

export const ORGANISATION_ROLE_STATUSES = ["active", "retired"] as const;
export const OrganisationRoleStatusSchema = z.enum(ORGANISATION_ROLE_STATUSES);
export type OrganisationRoleStatus = z.infer<
  typeof OrganisationRoleStatusSchema
>;

const OrganisationRoleTitleSchema = z
  .string()
  .trim()
  .min(ORGANISATION_ROLE_TITLE_MIN)
  .max(ORGANISATION_ROLE_TITLE_MAX);

/** `POST /v1/admin/organisation-roles` — «Добавить роль». The slug is the server's. */
export const CreateOrganisationRoleRequestSchema = z
  .object({ title: OrganisationRoleTitleSchema })
  .strict();
export type CreateOrganisationRoleRequest = z.infer<
  typeof CreateOrganisationRoleRequestSchema
>;

/** `PATCH /v1/admin/organisation-roles/:id` — rename, under `If-Match`. */
export const UpdateOrganisationRoleRequestSchema = z
  .object({ title: OrganisationRoleTitleSchema })
  .strict();
export type UpdateOrganisationRoleRequest = z.infer<
  typeof UpdateOrganisationRoleRequestSchema
>;

/** A role as an organisation carries it (EARS-2): a retired one is marked by its status. */
export const OrganisationRoleRefSchema = z.object({
  id: z.string(),
  slug: SlugSchema,
  title: z.string(),
  status: OrganisationRoleStatusSchema,
});
export type OrganisationRoleRef = z.infer<typeof OrganisationRoleRefSchema>;

/** The admin projection of one role, with the number of organisations holding it. */
export const OrganisationRoleAdminDetailSchema =
  OrganisationRoleRefSchema.extend({
    /** Every organisation holding the role, whatever its status (032 EARS-3). */
    organisationCount: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    createdAt: z.string(),
    updatedAt: z.string(),
  });
export type OrganisationRoleAdminDetail = z.infer<
  typeof OrganisationRoleAdminDetailSchema
>;

/** `GET /v1/admin/organisation-roles` — a small book, so one unpaged list ordered by title. */
export const OrganisationRoleAdminListSchema = z.object({
  data: z.array(OrganisationRoleAdminDetailSchema),
  total: z.number().int().nonnegative(),
});
export type OrganisationRoleAdminList = z.infer<
  typeof OrganisationRoleAdminListSchema
>;

/** `status=active` is what every organisation form reads (EARS-2/EARS-3). */
export const OrganisationRoleAdminListQuerySchema = z
  .object({ status: OrganisationRoleStatusSchema.optional() })
  .strict();
export type OrganisationRoleAdminListQuery = z.infer<
  typeof OrganisationRoleAdminListQuerySchema
>;

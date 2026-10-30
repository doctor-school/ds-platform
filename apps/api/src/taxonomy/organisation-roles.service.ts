import { Inject, Injectable } from "@nestjs/common";
import type { OrganisationRole } from "@ds/db";
import {
  type CreateOrganisationRoleRequest,
  type OrganisationRoleAdminDetail,
  type OrganisationRoleAdminList,
  type OrganisationRoleAdminListQuery,
  taxonomyETag,
  type UpdateOrganisationRoleRequest,
} from "@ds/schemas";
import {
  type IdempotencyLease,
  IdempotencyService,
} from "./idempotency.service.js";
import { OrganisationRolesRepository } from "./organisation-roles.repository.js";
import { markReplayable, TaxonomyError } from "./taxonomy.errors.js";
import { allocateTaxonomySlug, taxonomySlugBase } from "./taxonomy-slug.js";

// 032 EARS-3 (#3492) — the organisation-role reference book commands. A role is
// an ordinary retained row: a system slug allocated once, a version behind the
// ETag, and a title unique among ACTIVE roles case-insensitively. A duplicate
// title is a field-addressed `VALIDATION_FAILED` on `title` — the same answer
// the pre-check and the partial unique index `organisation_roles_active_title_key`
// give. Retire / restore (EARS-4) are not part of this slice.

const ACTIVE_TITLE_INDEX = "organisation_roles_active_title_key";

export interface CreateOrganisationRoleInput {
  payload: CreateOrganisationRoleRequest;
  lease: IdempotencyLease;
}

export interface UpdateOrganisationRoleInput {
  id: string;
  payload: UpdateOrganisationRoleRequest;
  expectedVersion: number;
  lease: IdempotencyLease;
}

export interface OrganisationRoleCommandResult {
  detail: OrganisationRoleAdminDetail;
  etag: string;
}

@Injectable()
export class OrganisationRolesService {
  // Explicit @Inject tokens — the `endpoint-authz` gate boots this graph under
  // `tsx`, which emits no `design:paramtypes`.
  constructor(
    @Inject(OrganisationRolesRepository)
    private readonly repo: OrganisationRolesRepository,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  /** `GET /v1/admin/organisation-roles` — the whole book, ordered by title. */
  async list(
    query: OrganisationRoleAdminListQuery,
  ): Promise<OrganisationRoleAdminList> {
    const rows = await this.repo.list(query.status);
    return {
      data: rows.map((row) => toDetail(row, row.organisationCount)),
      total: rows.length,
    };
  }

  /** `POST /v1/admin/organisation-roles` — «Добавить роль». */
  create(
    input: CreateOrganisationRoleInput,
  ): Promise<OrganisationRoleCommandResult> {
    return this.fenced(input.lease, () => this.createCommand(input));
  }

  /** `PATCH /v1/admin/organisation-roles/:id` — rename the SAME row. */
  update(
    input: UpdateOrganisationRoleInput,
  ): Promise<OrganisationRoleCommandResult> {
    return this.fenced(input.lease, () => this.updateCommand(input));
  }

  private async fenced<T>(
    lease: IdempotencyLease,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (err) {
      throw markReplayable(asDuplicateTitle(err) ?? err, lease);
    }
  }

  private async createCommand(
    input: CreateOrganisationRoleInput,
  ): Promise<OrganisationRoleCommandResult> {
    const { title } = input.payload;
    const base = taxonomySlugBase(title, "organisation-role");
    const row = await this.repo.transaction(async (tx) => {
      await this.repo.lockTitle(tx, title);
      if (await this.repo.activeTitleTaken(tx, title)) throw duplicateTitle();
      await this.repo.lockSlugSequence(tx, base);
      const slug = await allocateTaxonomySlug(
        base,
        "organisation-role",
        (candidate) => this.repo.slugTaken(tx, candidate),
      );
      const created = await this.repo.insert(tx, { slug, title });
      await this.idempotency.complete(tx, input.lease, {
        status: 201,
        body: toDetail(created, 0),
        etag: taxonomyETag(created.version),
        location: `/v1/admin/organisation-roles/${created.id}`,
      });
      return created;
    });
    return { detail: toDetail(row, 0), etag: taxonomyETag(row.version) };
  }

  private async updateCommand(
    input: UpdateOrganisationRoleInput,
  ): Promise<OrganisationRoleCommandResult> {
    const { title } = input.payload;
    const result = await this.repo.transaction(async (tx) => {
      const locked = await this.repo.lockById(tx, input.id);
      if (!locked) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      if (locked.version !== input.expectedVersion) throw stale();
      await this.repo.lockTitle(tx, title);
      if (
        locked.status === "active" &&
        (await this.repo.activeTitleTaken(tx, title, input.id))
      ) {
        throw duplicateTitle();
      }
      const renamed = await this.repo.renameVersioned(
        tx,
        input.id,
        input.expectedVersion,
        title,
      );
      if (!renamed) throw stale();
      const count = await this.repo.holderCount(tx, renamed.id);
      await this.idempotency.complete(tx, input.lease, {
        status: 200,
        body: toDetail(renamed, count),
        etag: taxonomyETag(renamed.version),
      });
      return { row: renamed, count };
    });
    return {
      detail: toDetail(result.row, result.count),
      etag: taxonomyETag(result.row.version),
    };
  }
}

function toDetail(
  row: OrganisationRole,
  organisationCount: number,
): OrganisationRoleAdminDetail {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    organisationCount,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function stale(): TaxonomyError {
  return new TaxonomyError(
    "PRECONDITION_FAILED",
    "the role changed since it was read; reload and retry",
  );
}

function duplicateTitle(): TaxonomyError {
  return new TaxonomyError(
    "VALIDATION_FAILED",
    "an active role already has this title",
    [{ path: "title", message: "an active role already has this title" }],
  );
}

/**
 * The partial unique index is the final race guard behind the pre-check; its
 * `23505` is the same field refusal, never an opaque 500. Drizzle wraps the
 * driver error, so the whole `cause` chain is walked.
 */
function asDuplicateTitle(error: unknown): TaxonomyError | null {
  for (let node: unknown = error, depth = 0; node && depth < 5; depth += 1) {
    const candidate = node as {
      code?: unknown;
      constraint?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (candidate.code === "23505") {
      const hit =
        candidate.constraint === ACTIVE_TITLE_INDEX ||
        (typeof candidate.message === "string" &&
          candidate.message.includes(ACTIVE_TITLE_INDEX));
      return hit ? duplicateTitle() : null;
    }
    node = candidate.cause;
  }
  return null;
}

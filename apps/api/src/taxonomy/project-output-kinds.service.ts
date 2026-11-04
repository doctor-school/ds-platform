import { Inject, Injectable } from "@nestjs/common";
import type { ProjectOutputKind } from "@ds/db";
import {
  type CreateProjectOutputKindRequest,
  OUTPUT_KIND_IN_USE_PATH_PREFIX,
  type ProjectOutputKindAdminDetail,
  type ProjectOutputKindAdminList,
  type ProjectOutputKindAdminListQuery,
  taxonomyETag,
  type UpdateProjectOutputKindRequest,
} from "@ds/schemas";
import {
  type IdempotencyLease,
  IdempotencyService,
} from "./idempotency.service.js";
import { ProjectOutputKindsRepository } from "./project-output-kinds.repository.js";
import { markReplayable, TaxonomyError } from "./taxonomy.errors.js";
import { allocateTaxonomySlug, taxonomySlugBase } from "./taxonomy-slug.js";

// 030 EARS-3 (#3503) — the «Виды результатов» commands: add, rename, retire
// (refused with `409 OUTPUT_KIND_IN_USE` while a result of a draft or published
// project holds the kind) and restore under the same id. The 032 role-book
// pattern: a system slug allocated once, a version behind the ETag, a title
// unique among ACTIVE kinds case-insensitively (a duplicate is a `title` field
// error, from the pre-check or the partial unique index alike).

const ACTIVE_TITLE_INDEX = "project_output_kinds_active_title_key";

export interface CreateProjectOutputKindInput {
  payload: CreateProjectOutputKindRequest;
  lease: IdempotencyLease;
}

export interface UpdateProjectOutputKindInput {
  id: string;
  payload: UpdateProjectOutputKindRequest;
  expectedVersion: number;
  lease: IdempotencyLease;
}

export interface ProjectOutputKindTransitionInput {
  id: string;
  expectedVersion: number;
  lease: IdempotencyLease;
}

export interface ProjectOutputKindCommandResult {
  detail: ProjectOutputKindAdminDetail;
  etag: string;
}

@Injectable()
export class ProjectOutputKindsService {
  // Explicit @Inject tokens — the `endpoint-authz` gate boots this graph under
  // `tsx`, which emits no `design:paramtypes`.
  constructor(
    @Inject(ProjectOutputKindsRepository)
    private readonly repo: ProjectOutputKindsRepository,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  /** `GET /v1/admin/project-output-kinds` — the whole book with result counts. */
  async list(
    query: ProjectOutputKindAdminListQuery,
  ): Promise<ProjectOutputKindAdminList> {
    const rows = await this.repo.list(query.status);
    return {
      data: rows.map((row) => toDetail(row, row.resultCount)),
      total: rows.length,
    };
  }

  create(
    input: CreateProjectOutputKindInput,
  ): Promise<ProjectOutputKindCommandResult> {
    return this.fenced(input.lease, () => this.createCommand(input));
  }

  update(
    input: UpdateProjectOutputKindInput,
  ): Promise<ProjectOutputKindCommandResult> {
    return this.fenced(input.lease, () => this.updateCommand(input));
  }

  retire(
    input: ProjectOutputKindTransitionInput,
  ): Promise<ProjectOutputKindCommandResult> {
    return this.fenced(input.lease, () => this.transition(input, "retired"));
  }

  restore(
    input: ProjectOutputKindTransitionInput,
  ): Promise<ProjectOutputKindCommandResult> {
    return this.fenced(input.lease, () => this.transition(input, "active"));
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
    input: CreateProjectOutputKindInput,
  ): Promise<ProjectOutputKindCommandResult> {
    const { title } = input.payload;
    const base = taxonomySlugBase(title, "project-output-kind");
    const row = await this.repo.transaction(async (tx) => {
      await this.repo.lockTitle(tx, title);
      if (await this.repo.activeTitleTaken(tx, title)) throw duplicateTitle();
      await this.repo.lockSlugSequence(tx, base);
      const slug = await allocateTaxonomySlug(
        base,
        "project-output-kind",
        (candidate) => this.repo.slugTaken(tx, candidate),
      );
      const created = await this.repo.insert(tx, { slug, title });
      await this.idempotency.complete(tx, input.lease, {
        status: 201,
        body: toDetail(created, 0),
        etag: taxonomyETag(created.version),
        location: `/v1/admin/project-output-kinds/${created.id}`,
      });
      return created;
    });
    return { detail: toDetail(row, 0), etag: taxonomyETag(row.version) };
  }

  private async updateCommand(
    input: UpdateProjectOutputKindInput,
  ): Promise<ProjectOutputKindCommandResult> {
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
      const renamed = await this.repo.updateVersioned(
        tx,
        input.id,
        input.expectedVersion,
        { title },
      );
      if (!renamed) throw stale();
      const count = await this.repo.resultCount(tx, renamed.id);
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

  /**
   * Retire / restore under the kind's row lock (`FOR UPDATE`). A results save
   * reads the kind `FOR SHARE` after locking its project, so the holder check
   * below cannot miss a save that is adding the kind: one of the two waits.
   */
  private async transition(
    input: ProjectOutputKindTransitionInput,
    to: "active" | "retired",
  ): Promise<ProjectOutputKindCommandResult> {
    const result = await this.repo.transaction(async (tx) => {
      const locked = await this.repo.lockById(tx, input.id);
      if (!locked) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      if (locked.version !== input.expectedVersion) throw stale();
      if (locked.status === to) {
        throw new TaxonomyError(
          "INVALID_TRANSITION",
          to === "retired"
            ? "this output kind is already retired"
            : "this output kind is already active",
        );
      }
      if (to === "retired") {
        const holders = await this.repo.holders(tx, input.id);
        if (holders.length > 0) {
          throw new TaxonomyError(
            "OUTPUT_KIND_IN_USE",
            "results of these projects still hold this output kind",
            holders.map((h) => ({
              path: `${OUTPUT_KIND_IN_USE_PATH_PREFIX}${h.id}`,
              message: h.title,
            })),
          );
        }
      } else {
        await this.repo.lockTitle(tx, locked.title);
        if (await this.repo.activeTitleTaken(tx, locked.title, input.id)) {
          throw duplicateTitle();
        }
      }
      const moved = await this.repo.updateVersioned(
        tx,
        input.id,
        input.expectedVersion,
        to === "retired"
          ? { status: "retired", deletedAt: new Date() }
          : { status: "active", deletedAt: null },
      );
      if (!moved) throw stale();
      const count = await this.repo.resultCount(tx, moved.id);
      await this.idempotency.complete(tx, input.lease, {
        status: 200,
        body: toDetail(moved, count),
        etag: taxonomyETag(moved.version),
      });
      return { row: moved, count };
    });
    return {
      detail: toDetail(result.row, result.count),
      etag: taxonomyETag(result.row.version),
    };
  }
}

function toDetail(
  row: ProjectOutputKind,
  resultCount: number,
): ProjectOutputKindAdminDetail {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    resultCount,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function stale(): TaxonomyError {
  return new TaxonomyError(
    "PRECONDITION_FAILED",
    "the output kind changed since it was read; reload and retry",
  );
}

function duplicateTitle(): TaxonomyError {
  return new TaxonomyError(
    "VALIDATION_FAILED",
    "an active output kind already has this title",
    [{ path: "title", message: "an active output kind already has this title" }],
  );
}

/**
 * The partial unique index is the final race guard behind the pre-check; its
 * `23505` is the same field refusal, never an opaque 500.
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

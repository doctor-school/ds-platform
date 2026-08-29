import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Project } from "@ds/db";
import {
  type AdminTaxonomyListQuery,
  type CreateProjectRequest,
  type ProjectAdminDetail,
  type ProjectAdminList,
  taxonomyETag,
  type UpdateProjectRequest,
} from "@ds/schemas";
import {
  OBJECT_STORAGE,
  ObjectAlreadyExistsError,
  type ObjectStorage,
} from "../storage/index.js";
import {
  type IdempotencyLease,
  IdempotencyService,
} from "./idempotency.service.js";
import { MediaCleanupService } from "./media/media-cleanup.service.js";
import {
  type NormalizedImage,
  StillImageNormalizer,
  type UploadedImage,
} from "./media/still-image-normalizer.js";
import { ProjectsRepository } from "./projects.repository.js";
import { markReplayable, TaxonomyError } from "./taxonomy.errors.js";
import { allocateTaxonomySlug, taxonomySlugBase } from "./taxonomy-slug.js";

// 012 EARS-1 (#1283) — the project authoring commands. This is the layer where
// the §5.1 failure ORDER is realized, and the order is the contract:
//
//   auth (guard) → key shape → fingerprint binding → normalization → upload →
//   domain transaction (precondition recheck → ref swap → audit → fenced record
//   completion).
//
// So: a keyless upload never streams; a reused key never normalizes; a storage
// outage never mutates a domain row; and a committed row's superseded object
// always leaves behind a durable cleanup obligation.

/** Where project covers live in the bucket. */
const COVER_PREFIX = "taxonomy/projects/covers";

export interface CreateProjectInput {
  payload: CreateProjectRequest;
  cover?: UploadedImage | undefined;
  lease: IdempotencyLease;
}

export interface UpdateProjectInput {
  id: string;
  payload: UpdateProjectRequest;
  cover?: UploadedImage | undefined;
  expectedVersion: number;
  lease: IdempotencyLease;
}

/** A command result plus the ETag the client must echo on its next write. */
export interface ProjectCommandResult {
  detail: ProjectAdminDetail;
  etag: string;
}

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  // Every dependency carries an EXPLICIT @Inject token, including the class
  // ones. Reason: the repo's root-level tooling (the endpoint-authz gate) boots
  // this module graph under `tsx`, whose esbuild transform does not implement
  // `emitDecoratorMetadata` — so `design:paramtypes` is absent and any param
  // Nest must infer from its TYPE resolves to `undefined`. `nest build` (tsc)
  // does emit it, which is exactly what makes the failure mode nasty: DI works
  // in production and dies only in the gate. Explicit tokens are correct under
  // both compilers.
  constructor(
    @Inject(ProjectsRepository) private readonly repo: ProjectsRepository,
    @Inject(StillImageNormalizer)
    private readonly normalizer: StillImageNormalizer,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(MediaCleanupService) private readonly cleanup: MediaCleanupService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** `POST /v1/admin/projects` — create one draft project. */
  create(input: CreateProjectInput): Promise<ProjectCommandResult> {
    return this.fenced(input.lease, () => this.createCommand(input));
  }

  /** `PATCH /v1/admin/projects/:id` — edit the SAME row. */
  update(input: UpdateProjectInput): Promise<ProjectCommandResult> {
    return this.fenced(input.lease, () => this.updateCommand(input));
  }

  /**
   * Run a command that already reserved an idempotency record and tag any
   * DETERMINISTIC refusal with that record, so the problem filter fenced-stores
   * the outcome and an exact retry replays it (§6 bullet 3 / EARS-17).
   *
   * One wrapper per command rather than a tag at each throw site: the set of
   * deterministic codes is a spec table (`DETERMINISTIC_TERMINAL_ERROR_CODES`),
   * and a new refusal added inside a command inherits the right behaviour without
   * anyone remembering to mark it. A fault OUTSIDE that set (a DB timeout, an
   * uncertain commit) passes through untagged and stays takeover-eligible.
   */
  private async fenced<T>(
    lease: IdempotencyLease,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (err) {
      throw markReplayable(err, lease);
    }
  }

  private async createCommand(
    input: CreateProjectInput,
  ): Promise<ProjectCommandResult> {
    const base = taxonomySlugBase(input.payload.title, "project");

    const uploaded = input.cover
      ? await this.normalizeAndUpload(input.cover, input.lease)
      : null;

    const row = await this.repo.transaction(async (tx) => {
      await this.repo.lockSlugSequence(tx, base);
      const slug = await allocateTaxonomySlug(base, "project", (candidate) =>
        this.repo.slugTaken(tx, candidate),
      );
      const created = await this.repo.insert(tx, {
        slug,
        kind: input.payload.kind,
        title: input.payload.title,
        description: input.payload.description ?? null,
        coverRef: uploaded?.key ?? null,
      });
      const detail = await this.toDetail(created);
      await this.idempotency.complete(tx, input.lease, {
        status: 201,
        body: detail,
        etag: taxonomyETag(created.version),
        location: `/v1/admin/projects/${created.id}`,
      });
      return created;
    });

    return {
      detail: await this.toDetail(row),
      etag: taxonomyETag(row.version),
    };
  }

  private async updateCommand(
    input: UpdateProjectInput,
  ): Promise<ProjectCommandResult> {
    const current = await this.repo.findById(input.id);
    if (!current) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    if (current.version !== input.expectedVersion) {
      throw new TaxonomyError(
        "PRECONDITION_FAILED",
        "the project changed since it was read; reload and retry",
      );
    }

    // A PATCH that would leave a PUBLISHED projection incomplete is refused
    // without touching value, version or audit history (012-design §2.2).
    const publishBlockers = publishRequirementBlockers(current, input.payload);
    if (current.status === "published" && publishBlockers.length > 0) {
      throw new TaxonomyError(
        "PUBLISH_REQUIREMENTS_NOT_MET",
        "a published project cannot be edited into an incomplete projection",
        publishBlockers,
      );
    }

    const uploaded = input.cover
      ? await this.normalizeAndUpload(input.cover, input.lease)
      : null;
    const clearing = input.payload.mediaAction === "clear";
    const releasedRef =
      (uploaded || clearing) && current.coverRef ? current.coverRef : null;

    const row = await this.repo.transaction(async (tx) => {
      // Re-read under the row lock: everything above was optimistic.
      const locked = await this.repo.lockById(tx, input.id);
      if (!locked) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      if (locked.version !== input.expectedVersion) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the project changed since it was read; reload and retry",
        );
      }
      const postLockBlockers = publishRequirementBlockers(
        locked,
        input.payload,
      );
      if (locked.status === "published" && postLockBlockers.length > 0) {
        throw new TaxonomyError(
          "PUBLISH_REQUIREMENTS_NOT_MET",
          "a published project cannot be edited into an incomplete projection",
          postLockBlockers,
        );
      }

      const updated = await this.repo.updateVersioned(
        tx,
        input.id,
        input.expectedVersion,
        {
          ...(input.payload.kind !== undefined
            ? { kind: input.payload.kind }
            : {}),
          ...(input.payload.title !== undefined
            ? { title: input.payload.title }
            : {}),
          ...(input.payload.description !== undefined
            ? { description: input.payload.description ?? null }
            : {}),
          ...(uploaded ? { coverRef: uploaded.key } : {}),
          ...(clearing && !uploaded ? { coverRef: null } : {}),
        },
      );
      if (!updated) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the project changed since it was read; reload and retry",
        );
      }
      // The released object's deletion obligation is durable and rides the SAME
      // transaction as the ref change (012-design §5.1).
      if (releasedRef && releasedRef !== updated.coverRef) {
        await this.cleanup.enqueue(tx, {
          cleanupKind: uploaded ? "replace" : "clear",
          entityKind: "project",
          entityId: updated.id,
          slot: "cover",
          objectKey: releasedRef,
        });
      }
      const detail = await this.toDetail(updated);
      await this.idempotency.complete(tx, input.lease, {
        status: 200,
        body: detail,
        etag: taxonomyETag(updated.version),
      });
      return updated;
    });

    return {
      detail: await this.toDetail(row),
      etag: taxonomyETag(row.version),
    };
  }

  /** `GET /v1/admin/projects/:id` — detail by stable id, retired rows included. */
  async detail(id: string): Promise<ProjectCommandResult> {
    const row = await this.repo.findById(id);
    if (!row) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    return {
      detail: await this.toDetail(row),
      etag: taxonomyETag(row.version),
    };
  }

  /** `GET /v1/admin/projects` — the shared admin list. */
  async list(query: AdminTaxonomyListQuery): Promise<ProjectAdminList> {
    const { rows, total } = await this.repo.list(query);
    return {
      data: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        kind: row.kind,
        title: row.title,
        status: row.status,
        version: row.version,
        updatedAt: row.updatedAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** The generated slug preview; non-transliterable titles use the system fallback. */
  previewSlug(title: string): string {
    return taxonomySlugBase(title, "project");
  }

  /**
   * Normalize the upload and PUT the canonical bytes under a deterministic,
   * record-scoped key with write-once semantics.
   *
   * An `ObjectAlreadyExistsError` is SUCCESS for a resumed request: the same
   * record + the same canonical content means the object already there is
   * exactly the object we were about to write. A genuine store failure is a
   * terminal 503 with zero domain mutation (012-design §5.1).
   */
  private async normalizeAndUpload(
    cover: UploadedImage,
    lease: IdempotencyLease,
  ): Promise<{ key: string; normalized: NormalizedImage }> {
    const normalized = await this.normalizer.normalize(cover);
    const key = this.idempotency.objectKeyFor({
      lease,
      prefix: COVER_PREFIX,
      canonicalSha256: normalized.canonicalSha256,
      extension: "webp",
    });
    // Record the locator BEFORE the PUT: an orphan we know about is reclaimable.
    await this.idempotency.noteUploadLocator(lease, key);
    try {
      await this.storage.put({
        key,
        body: normalized.body,
        contentType: normalized.contentType,
        onlyIfAbsent: true,
      });
    } catch (err) {
      if (err instanceof ObjectAlreadyExistsError) {
        this.logger.log(
          `cover object ${key} already present — resumed request`,
        );
        return { key, normalized };
      }
      this.logger.error(
        `object storage refused the cover PUT: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new TaxonomyError(
        "MEDIA_STORAGE_UNAVAILABLE",
        "the cover could not be stored; no project data changed",
      );
    }
    return { key, normalized };
  }

  private async toDetail(row: Project): Promise<ProjectAdminDetail> {
    return {
      id: row.id,
      slug: row.slug,
      kind: row.kind,
      title: row.title,
      description: row.description,
      coverUrl: row.coverRef ? await this.storage.urlFor(row.coverRef) : null,
      status: row.status,
      firstPublishedAt: row.firstPublishedAt?.toISOString() ?? null,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/**
 * Which publish-required fields the patch would leave empty (012-design §2.2 —
 * project publication requires `kind` and `description`; the curator requirement
 * is #1287's, one lock protocol later). Returned as field-addressed errors so
 * the form can point at the offending input instead of showing a generic banner.
 */
function publishRequirementBlockers(
  current: Project,
  patch: UpdateProjectRequest,
): { path: string; message: string }[] {
  const blockers: { path: string; message: string }[] = [];
  const description =
    patch.description !== undefined ? patch.description : current.description;
  if (description === null || description === undefined) {
    blockers.push({
      path: "description",
      message: "a published project requires a description",
    });
  }
  return blockers;
}

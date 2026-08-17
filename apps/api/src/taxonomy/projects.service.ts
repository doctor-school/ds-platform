import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Project } from "@ds/db";
import {
  type AdminTaxonomyListQuery,
  type CreateProjectRequest,
  type ProjectAdminDetail,
  type ProjectAdminList,
  slugifyTaxonomyTitle,
  SlugSchema,
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
import { TaxonomyError } from "./taxonomy.errors.js";

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
  async create(input: CreateProjectInput): Promise<ProjectCommandResult> {
    const slug = this.resolveCreateSlug(input.payload);
    // Pre-flight the conflict OUTSIDE the transaction so a doomed request never
    // normalizes or uploads; the unique index still guards the race.
    if (await this.repo.slugTakenAnywhere(slug)) {
      throw new TaxonomyError(
        "SLUG_CONFLICT",
        "another project already holds this slug; restore that record instead of re-creating it",
      );
    }

    const uploaded = input.cover
      ? await this.normalizeAndUpload(input.cover, input.lease)
      : null;

    const row = await this.repo.transaction(async (tx) => {
      if (await this.repo.slugTaken(tx, slug)) {
        throw new TaxonomyError(
          "SLUG_CONFLICT",
          "another project already holds this slug; restore that record instead of re-creating it",
        );
      }
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

    return { detail: await this.toDetail(row), etag: taxonomyETag(row.version) };
  }

  /** `PATCH /v1/admin/projects/:id` — edit the SAME row. */
  async update(input: UpdateProjectInput): Promise<ProjectCommandResult> {
    const current = await this.repo.findById(input.id);
    if (!current) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    if (current.version !== input.expectedVersion) {
      throw new TaxonomyError(
        "PRECONDITION_FAILED",
        "the project changed since it was read; reload and retry",
      );
    }

    // Slug immutability is a ROW-state refusal, not a shape one, and it is
    // checked before any upload: the permanent public identity of a published
    // project is never negotiable (012-design §2.2).
    if (input.payload.slug !== undefined) {
      if (current.firstPublishedAt !== null) {
        throw new TaxonomyError(
          "SLUG_IMMUTABLE",
          "the slug was locked by the first publication and cannot change",
        );
      }
      if (
        input.payload.slug !== current.slug &&
        (await this.repo.slugTakenAnywhere(input.payload.slug, current.id))
      ) {
        throw new TaxonomyError(
          "SLUG_CONFLICT",
          "another project already holds this slug",
        );
      }
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
      if (input.payload.slug !== undefined && locked.firstPublishedAt !== null) {
        throw new TaxonomyError(
          "SLUG_IMMUTABLE",
          "the slug was locked by the first publication and cannot change",
        );
      }
      const postLockBlockers = publishRequirementBlockers(locked, input.payload);
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
          ...(input.payload.slug !== undefined ? { slug: input.payload.slug } : {}),
          ...(input.payload.kind !== undefined ? { kind: input.payload.kind } : {}),
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

    return { detail: await this.toDetail(row), etag: taxonomyETag(row.version) };
  }

  /** `GET /v1/admin/projects/:id` — detail by stable id, retired rows included. */
  async detail(id: string): Promise<ProjectCommandResult> {
    const row = await this.repo.findById(id);
    if (!row) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    return { detail: await this.toDetail(row), etag: taxonomyETag(row.version) };
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

  /** The generated slug preview the admin form also computes locally. */
  previewSlug(title: string): string {
    return slugifyTaxonomyTitle(title);
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
        this.logger.log(`cover object ${key} already present — resumed request`);
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

  /** Resolve the create-time slug: the authored one, or generated from the title. */
  private resolveCreateSlug(payload: CreateProjectRequest): string {
    if (payload.slug) return payload.slug;
    const generated = slugifyTaxonomyTitle(payload.title);
    const parsed = SlugSchema.safeParse(generated);
    if (!parsed.success) {
      // The title yields no usable public identity. Refuse and let the operator
      // supply one — a fabricated slug would become a permanent public URL.
      throw new TaxonomyError(
        "VALIDATION_FAILED",
        "the title yields no usable slug; supply one explicitly",
        [{ path: "slug", message: "could not be generated from the title" }],
      );
    }
    return parsed.data;
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
      slugEditable: row.firstPublishedAt === null,
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

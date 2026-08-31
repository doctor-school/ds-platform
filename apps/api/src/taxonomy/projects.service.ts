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
import {
  type ExpertLifecycle,
  ProjectExpertsRepository,
} from "./project-experts.repository.js";
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

export interface PublishProjectInput {
  id: string;
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
    @Inject(ProjectExpertsRepository)
    private readonly relations: ProjectExpertsRepository,
  ) {}

  /** `POST /v1/admin/projects` — create one draft project. */
  create(input: CreateProjectInput): Promise<ProjectCommandResult> {
    return this.fenced(input.lease, () => this.createCommand(input));
  }

  /** `PATCH /v1/admin/projects/:id` — edit the SAME row. */
  update(input: UpdateProjectInput): Promise<ProjectCommandResult> {
    return this.fenced(input.lease, () => this.updateCommand(input));
  }

  /** `POST /v1/admin/projects/:id/publish` — `draft → published` (EARS-5). */
  publish(input: PublishProjectInput): Promise<ProjectCommandResult> {
    return this.fenced(input.lease, () => this.publishCommand(input));
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

  /**
   * `draft → published` with the §2.3 curator invariant enforced (EARS-5).
   *
   * The hard part is not the status write, it is the LOCK ORDER. §3.2 fixes it
   * as «every affected expert, ascending stable id → the project», and the set
   * of affected experts is itself a query result — so the command discovers the
   * curator set OPTIMISTICALLY, locks exactly those experts, locks the project,
   * then re-runs the discovery under both locks. A set that moved is a 412: the
   * alternative would be locking an expert AFTER the project, which is the
   * deadlock the order exists to prevent. There is deliberately no retry loop
   * here — the client re-reads and re-issues, which is also what makes the
   * idempotency record's fingerprint honest.
   *
   * Media and `websiteUrl`-style optional fields never block: §5.2 declares
   * `coverUrl` nullable, so a coverless published project is a COMPLETE
   * projection. Zero events and zero partners are likewise fine — only the
   * single active curator is structural.
   */
  private async publishCommand(
    input: PublishProjectInput,
  ): Promise<ProjectCommandResult> {
    // Optimistic pre-flight OUTSIDE the transaction: a doomed request never
    // opens one. Every check below repeats under the locks.
    const current = await this.repo.findById(input.id);
    if (!current) throw new TaxonomyError("RESOURCE_NOT_FOUND");

    const row = await this.repo.transaction(async (tx) => {
      // 1. Discover the affected experts BEFORE any lock — an unlocked read, so
      //    it cannot itself violate the order it is about to establish.
      const discovered = await this.relations.activeCuratorExpertIds(
        tx,
        input.id,
      );
      // 2. Lock them, ascending stable id (the repository owns the ordering).
      const lockedExperts = await this.relations.lockExperts(tx, discovered);
      // 3. Only now the project.
      const locked = await this.repo.lockById(tx, input.id);
      if (!locked) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      if (locked.version !== input.expectedVersion) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the project changed since it was read; reload and retry",
        );
      }
      if (locked.status !== "draft") {
        throw new TaxonomyError(
          "INVALID_TRANSITION",
          locked.status === "published"
            ? "this project is already published"
            : "this project is retired; restore it before publishing it again",
        );
      }

      // 4. Re-run the discovery under both locks. A curator linked, retired or
      //    re-pointed since step 1 changes the set, and this publish was decided
      //    against a set the operator never saw.
      const confirmed = await this.relations.activeCuratorExpertIds(
        tx,
        input.id,
      );
      if (
        confirmed.length !== discovered.length ||
        confirmed.some((id, index) => id !== discovered[index])
      ) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the project's curator changed while this publish was being decided; reload and retry",
        );
      }

      // 5. The field matrix, then the structural invariant. Field blockers come
      //    first because they are the ones a form can point at.
      const blockers = publishRequirementBlockers(locked);
      if (blockers.length > 0) {
        throw new TaxonomyError(
          "PUBLISH_REQUIREMENTS_NOT_MET",
          "this project is not complete enough to publish",
          blockers,
        );
      }
      assertExactlyOneEligibleCurator(confirmed, lockedExperts);

      const moved = await this.repo.transitionVersioned(
        tx,
        input.id,
        input.expectedVersion,
        {
          status: "published",
          deletedAt: null,
          // Set ONCE and never re-stamped: a republished project keeps the date
          // it first became public, which is what pins its slug (LD-3).
          ...(locked.firstPublishedAt ? {} : { firstPublishedAt: new Date() }),
        },
      );
      if (!moved) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the project changed since it was read; reload and retry",
        );
      }
      const detail = await this.toDetail(moved);
      await this.idempotency.complete(tx, input.lease, {
        status: 200,
        body: detail,
        etag: taxonomyETag(moved.version),
      });
      return moved;
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
  patch: UpdateProjectRequest = {},
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

/**
 * §2.3's published-project curator invariant: EXACTLY ONE active curator link,
 * pointing at an expert that is itself publicly visible — `published`, not
 * retired, not editorially removed.
 *
 * A separate error code from `PUBLISH_REQUIREMENTS_NOT_MET` on purpose: the
 * field matrix is answered by typing into this form, while this one is answered
 * on a different screen (the project's expert links, or the curator's own
 * record). Collapsing them would send the operator to fix a field that is not
 * the problem.
 *
 * `lockedExperts` is the FOR-UPDATE read of exactly `curatorIds`, so an expert
 * missing from it is one that vanished between discovery and the lock — treated
 * as ineligible rather than as absent, because the row is gone either way.
 */
function assertExactlyOneEligibleCurator(
  curatorIds: readonly string[],
  lockedExperts: readonly ExpertLifecycle[],
): void {
  if (curatorIds.length === 0) {
    throw new TaxonomyError(
      "PUBLISHED_PROJECT_REQUIRES_CURATOR",
      "a published project needs exactly one active curator; this project has none",
    );
  }
  if (curatorIds.length > 1) {
    throw new TaxonomyError(
      "PUBLISHED_PROJECT_REQUIRES_CURATOR",
      "a published project needs exactly one active curator; this project has more than one",
    );
  }
  const curator = lockedExperts.find((expert) => expert.id === curatorIds[0]);
  const eligible =
    curator !== undefined &&
    curator.status === "published" &&
    curator.deletedAt === null &&
    curator.contentRemovedAt === null;
  if (!eligible) {
    throw new TaxonomyError(
      "PUBLISHED_PROJECT_REQUIRES_CURATOR",
      "the project's curator is not publicly visible; publish the curator first",
    );
  }
}

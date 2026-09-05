import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Expert } from "@ds/db";
import {
  type AdminTaxonomyListQuery,
  type CreateExpertRequest,
  type EligibleExpertUserList,
  type EligibleExpertUserQuery,
  type ExpertAdminDetail,
  type ExpertAdminList,
  expertDisplayName,
  expertInitials,
  taxonomyETag,
  type UpdateExpertRequest,
} from "@ds/schemas";
import {
  OBJECT_STORAGE,
  ObjectAlreadyExistsError,
  type ObjectStorage,
} from "../storage/index.js";
import {
  type ExpertEventSlot,
  ExpertsRepository,
} from "./experts.repository.js";
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
import { markReplayable, TaxonomyError } from "./taxonomy.errors.js";
import { allocateTaxonomySlug, taxonomySlugBase } from "./taxonomy-slug.js";

// 012 EARS-2 (#1284) — the expert authoring commands. Same §5.1 failure ORDER
// the project vertical established, against the SAME three shared services:
//
//   auth (guard) → key shape → fingerprint binding → normalization → upload →
//   domain transaction (precondition recheck → ref swap → audit → fenced record
//   completion).
//
// The expert-specific parts are only three: the slug is generated from the NAME
// rather than a title, the media slot is `photo`, and a photo-less row carries
// server-computed initials instead of an image (012-design §2.2).

/** Where expert photos live in the bucket. */
const PHOTO_PREFIX = "taxonomy/experts/photos";

export interface CreateExpertInput {
  payload: CreateExpertRequest;
  photo?: UploadedImage | undefined;
  lease: IdempotencyLease;
}

export interface UpdateExpertInput {
  id: string;
  payload: UpdateExpertRequest;
  photo?: UploadedImage | undefined;
  expectedVersion: number;
  lease: IdempotencyLease;
}

export interface PublishExpertInput {
  id: string;
  expectedVersion: number;
  lease: IdempotencyLease;
}

/** A command result plus the ETag the client must echo on its next write. */
export interface ExpertCommandResult {
  detail: ExpertAdminDetail;
  etag: string;
}

@Injectable()
export class ExpertsService {
  private readonly logger = new Logger(ExpertsService.name);

  // Explicit @Inject tokens on every dependency, class ones included — the
  // root-level `endpoint-authz` gate boots this module graph under `tsx`, whose
  // esbuild transform emits no `design:paramtypes`, so a type-inferred injection
  // resolves to `undefined` there while working fine under `nest build`.
  constructor(
    @Inject(ExpertsRepository) private readonly repo: ExpertsRepository,
    @Inject(StillImageNormalizer)
    private readonly normalizer: StillImageNormalizer,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(MediaCleanupService) private readonly cleanup: MediaCleanupService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** `POST /v1/admin/experts` — create one draft expert. */
  create(input: CreateExpertInput): Promise<ExpertCommandResult> {
    return this.fenced(input.lease, () => this.createCommand(input));
  }

  /** `PATCH /v1/admin/experts/:id` — edit the SAME row. */
  update(input: UpdateExpertInput): Promise<ExpertCommandResult> {
    return this.fenced(input.lease, () => this.updateCommand(input));
  }

  /** `POST /v1/admin/experts/:id/publish` — `draft → published` (EARS-5). */
  publish(input: PublishExpertInput): Promise<ExpertCommandResult> {
    return this.fenced(input.lease, () => this.publishCommand(input));
  }

  /**
   * Run a command that already reserved an idempotency record and tag any
   * DETERMINISTIC refusal with that record, so the problem filter fenced-stores
   * the outcome and an exact retry replays it (§6 bullet 3 / EARS-17).
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
    input: CreateExpertInput,
  ): Promise<ExpertCommandResult> {
    const name = expertDisplayName({
      familyName: input.payload.familyName,
      givenName: input.payload.givenName,
      patronymic: input.payload.patronymic ?? null,
    })!;
    const base = taxonomySlugBase(name, "expert");
    if (input.payload.userId) {
      await this.assertUserLinkAvailable(input.payload.userId);
    }

    const uploaded = input.photo
      ? await this.normalizeAndUpload(input.photo, input.lease)
      : null;

    const row = await this.repo.transaction(async (tx) => {
      await this.repo.lockSlugSequence(tx, base);
      const slug = await allocateTaxonomySlug(base, "expert", (candidate) =>
        this.repo.slugTaken(tx, candidate),
      );
      if (input.payload.userId) {
        const link = await this.repo.lockUserAndFindOwner(
          tx,
          input.payload.userId,
        );
        this.assertUserLinkState(link);
      }
      const created = await this.repo.insert(tx, {
        slug,
        familyName: input.payload.familyName,
        givenName: input.payload.givenName,
        patronymic: input.payload.patronymic ?? null,
        userId: input.payload.userId ?? null,
        professionalRole: input.payload.professionalRole ?? null,
        credentials: input.payload.credentials ?? null,
        affiliation: input.payload.affiliation ?? null,
        bio: input.payload.bio ?? null,
        photoRef: uploaded?.key ?? null,
      });
      const detail = await this.toDetail(created);
      await this.idempotency.complete(tx, input.lease, {
        status: 201,
        body: detail,
        etag: taxonomyETag(created.version),
        location: `/v1/admin/experts/${created.id}`,
      });
      return created;
    });

    return {
      detail: await this.toDetail(row),
      etag: taxonomyETag(row.version),
    };
  }

  private async updateCommand(
    input: UpdateExpertInput,
  ): Promise<ExpertCommandResult> {
    const current = await this.repo.findById(input.id);
    if (!current) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    if (current.version !== input.expectedVersion) {
      throw new TaxonomyError(
        "PRECONDITION_FAILED",
        "the expert changed since it was read; reload and retry",
      );
    }
    // A person who asked to be taken off the site is never repopulated by an
    // ordinary edit (012-design §2.4 / EARS-14). #1306 owns the removal itself;
    // this refusal exists from day one so no window allows the repopulation.
    if (current.contentRemovedAt !== null) {
      throw new TaxonomyError(
        "CONTENT_REMOVED",
        "this expert record was editorially removed and cannot be repopulated",
      );
    }

    if (typeof input.payload.userId === "string") {
      await this.assertUserLinkAvailable(input.payload.userId, current.id);
    }

    const publishBlockers = publishRequirementBlockers(current, input.payload);
    if (current.status === "published" && publishBlockers.length > 0) {
      throw new TaxonomyError(
        "PUBLISH_REQUIREMENTS_NOT_MET",
        "a published expert cannot be edited into an incomplete projection",
        publishBlockers,
      );
    }

    const uploaded = input.photo
      ? await this.normalizeAndUpload(input.photo, input.lease)
      : null;
    const clearing = input.payload.mediaAction === "clear";
    const releasedRef =
      (uploaded || clearing) && current.photoRef ? current.photoRef : null;

    const row = await this.repo.transaction(async (tx) => {
      // Re-read under the row lock: everything above was optimistic.
      const locked = await this.repo.lockById(tx, input.id);
      if (!locked) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      if (locked.version !== input.expectedVersion) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the expert changed since it was read; reload and retry",
        );
      }
      if (locked.contentRemovedAt !== null) {
        throw new TaxonomyError(
          "CONTENT_REMOVED",
          "this expert record was editorially removed and cannot be repopulated",
        );
      }
      if (typeof input.payload.userId === "string") {
        const link = await this.repo.lockUserAndFindOwner(
          tx,
          input.payload.userId,
          locked.id,
        );
        this.assertUserLinkState(link);
      }
      const postLockBlockers = publishRequirementBlockers(
        locked,
        input.payload,
      );
      if (locked.status === "published" && postLockBlockers.length > 0) {
        throw new TaxonomyError(
          "PUBLISH_REQUIREMENTS_NOT_MET",
          "a published expert cannot be edited into an incomplete projection",
          postLockBlockers,
        );
      }

      const updated = await this.repo.updateVersioned(
        tx,
        input.id,
        input.expectedVersion,
        {
          ...(input.payload.familyName !== undefined
            ? { familyName: input.payload.familyName }
            : {}),
          ...(input.payload.givenName !== undefined
            ? { givenName: input.payload.givenName }
            : {}),
          ...(input.payload.patronymic !== undefined
            ? { patronymic: input.payload.patronymic ?? null }
            : {}),
          ...(input.payload.userId !== undefined
            ? { userId: input.payload.userId }
            : {}),
          ...(input.payload.professionalRole !== undefined
            ? { professionalRole: input.payload.professionalRole ?? null }
            : {}),
          ...(input.payload.credentials !== undefined
            ? { credentials: input.payload.credentials ?? null }
            : {}),
          ...(input.payload.affiliation !== undefined
            ? { affiliation: input.payload.affiliation ?? null }
            : {}),
          ...(input.payload.bio !== undefined
            ? { bio: input.payload.bio ?? null }
            : {}),
          ...(uploaded ? { photoRef: uploaded.key } : {}),
          ...(clearing && !uploaded ? { photoRef: null } : {}),
        },
      );
      if (!updated) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the expert changed since it was read; reload and retry",
        );
      }
      // The released object's deletion obligation is durable and rides the SAME
      // transaction as the ref change (012-design §5.1).
      if (releasedRef && releasedRef !== updated.photoRef) {
        await this.cleanup.enqueue(tx, {
          cleanupKind: uploaded ? "replace" : "clear",
          entityKind: "expert",
          entityId: updated.id,
          slot: "photo",
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
   * `draft → published`, which is a change to the SPEAKER PROJECTION of every
   * event this expert is linked to (012-design §4), not just to one row.
   *
   * An active `event_experts` link is invisible while its expert is a draft:
   * `eligibleExpertLinks` filters on `experts.status = 'published'`. Publishing
   * therefore makes every one of this expert's slots appear at once. Since the
   * EARS-24 cutover (#1607) `event_experts` is the ONLY speaker source, and two
   * active links can never share a position (the partial unique index
   * `event_experts_event_position_active_uniq` forbids it regardless of anyone's
   * publication state), so publication itself can no longer double-book a
   * position.
   *
   * Lock order is «parent events ascending, then the expert» — the same
   * ascending-id discipline §3.2 fixes for the project vertical, for the same
   * deadlock reason. A link set that moved between discovery and the locks is a
   * 412, never a late event lock.
   */
  private async publishCommand(
    input: PublishExpertInput,
  ): Promise<ExpertCommandResult> {
    // Optimistic pre-flight OUTSIDE the transaction: a doomed request never
    // opens one. Every check below repeats under the locks.
    const current = await this.repo.findById(input.id);
    if (!current) throw new TaxonomyError("RESOURCE_NOT_FOUND");

    const row = await this.repo.transaction(async (tx) => {
      // 1. Discover the affected events BEFORE any lock.
      const discovered = await this.repo.activeEventSlots(tx, input.id);
      // 2. Lock them, ascending stable id (the repository owns the ordering).
      await this.repo.lockEvents(
        tx,
        discovered.map((slot) => slot.eventId),
      );
      // 3. Only now the expert.
      const locked = await this.repo.lockById(tx, input.id);
      if (!locked) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      if (locked.version !== input.expectedVersion) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the expert changed since it was read; reload and retry",
        );
      }
      // §2.4: a person who asked to be taken off the site is never republished —
      // checked before the transition rule, because "removed" is the stronger
      // statement and must not be reported as a mere lifecycle mismatch.
      if (locked.contentRemovedAt !== null) {
        throw new TaxonomyError(
          "CONTENT_REMOVED",
          "this expert record was editorially removed and cannot be published",
        );
      }
      if (locked.status !== "draft") {
        throw new TaxonomyError(
          "INVALID_TRANSITION",
          locked.status === "published"
            ? "this expert is already published"
            : "this expert is retired; restore it before publishing it again",
        );
      }

      // 4. Re-run the discovery under the locks: a link added, retired or
      //    re-positioned since step 1 means this publish was decided against a
      //    projection the operator never saw.
      const confirmed = await this.repo.activeEventSlots(tx, input.id);
      if (!sameSlotSet(discovered, confirmed)) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "this expert's event links changed while the publish was being decided; reload and retry",
        );
      }

      const blockers = publishRequirementBlockers(locked);
      if (blockers.length > 0) {
        throw new TaxonomyError(
          "PUBLISH_REQUIREMENTS_NOT_MET",
          "this expert is not complete enough to publish",
          blockers,
        );
      }

      const moved = await this.repo.transitionVersioned(
        tx,
        input.id,
        input.expectedVersion,
        {
          status: "published",
          deletedAt: null,
          // Set ONCE and never re-stamped: a republished expert keeps the date
          // it first became public, which is what pins its slug (LD-3).
          ...(locked.firstPublishedAt ? {} : { firstPublishedAt: new Date() }),
        },
      );
      if (!moved) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the expert changed since it was read; reload and retry",
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

  /** `GET /v1/admin/experts/:id` — detail by stable id, retired rows included. */
  async detail(id: string): Promise<ExpertCommandResult> {
    const row = await this.repo.findById(id);
    if (!row) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    return {
      detail: await this.toDetail(row),
      etag: taxonomyETag(row.version),
    };
  }

  /** `GET /v1/admin/experts` — the shared admin list with LD-6 name search. */
  async list(query: AdminTaxonomyListQuery): Promise<ExpertAdminList> {
    const { rows, total } = await this.repo.list(query);
    return {
      data: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: expertDisplayName(row),
        professionalRole: row.professionalRole,
        status: row.status,
        version: row.version,
        updatedAt: row.updatedAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Expert-form selector; eligibility remains write-authoritative in the command. */
  async listEligibleUsers(
    query: EligibleExpertUserQuery,
  ): Promise<EligibleExpertUserList> {
    const { rows, total } = await this.repo.listEligibleUsers(query);
    return {
      data: rows,
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * Normalize the upload and PUT the canonical bytes under a deterministic,
   * record-scoped key with write-once semantics. Byte-for-byte the project
   * vertical's flow against the SAME shared normalizer — there is no second
   * decoder and no expert-specific media profile (012-design §2.2).
   */
  private async normalizeAndUpload(
    photo: UploadedImage,
    lease: IdempotencyLease,
  ): Promise<{ key: string; normalized: NormalizedImage }> {
    const normalized = await this.normalizer.normalize(photo);
    const key = this.idempotency.objectKeyFor({
      lease,
      prefix: PHOTO_PREFIX,
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
          `photo object ${key} already present — resumed request`,
        );
        return { key, normalized };
      }
      this.logger.error(
        `object storage refused the photo PUT: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new TaxonomyError(
        "MEDIA_STORAGE_UNAVAILABLE",
        "the photo could not be stored; no expert data changed",
      );
    }
    return { key, normalized };
  }

  private async toDetail(row: Expert): Promise<ExpertAdminDetail> {
    const name = expertDisplayName(row);
    return {
      id: row.id,
      slug: row.slug,
      name,
      familyName: row.familyName,
      givenName: row.givenName,
      patronymic: row.patronymic,
      userId: row.userId,
      professionalRole: row.professionalRole,
      credentials: row.credentials,
      affiliation: row.affiliation,
      bio: row.bio,
      photoUrl: row.photoRef ? await this.storage.urlFor(row.photoRef) : null,
      // Computed ONCE, server-side: the admin avatar, the public projection
      // (#1294) and the merged speaker projection (#1290) all render the same
      // fallback for the same person (012-design §2.2).
      initials: expertInitials(name),
      status: row.status,
      firstPublishedAt: row.firstPublishedAt?.toISOString() ?? null,
      contentRemovedAt: row.contentRemovedAt?.toISOString() ?? null,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async assertUserLinkAvailable(
    userId: string,
    exceptExpertId?: string,
  ): Promise<void> {
    this.assertUserLinkState(
      await this.repo.userLinkStateAnywhere(userId, exceptExpertId),
    );
  }

  private assertUserLinkState(link: { exists: boolean; owned: boolean }): void {
    if (!link.exists) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    if (link.owned) {
      throw new TaxonomyError(
        "USER_EXPERT_CONFLICT",
        "the selected User already owns another Expert",
      );
    }
  }
}

/**
 * Which publish-required fields the patch would leave empty. §2.2's authoring
 * matrix makes every descriptive expert field publish-required — the §5.2
 * `PublicExpert` DTO declares only `photoUrl` nullable, so a published expert
 * missing a role, credentials, an affiliation or a bio would render an
 * incomplete public projection. The photo stays optional by design: its absence
 * is answered by deterministic initials, not by an empty box.
 *
 * Publication itself is #1287; this function is the "a PATCH may not make a
 * PUBLISHED projection incomplete" half of the same contract (EARS-5).
 */
function publishRequirementBlockers(
  current: Expert,
  patch: UpdateExpertRequest = {},
): { path: string; message: string }[] {
  const required = [
    ["familyName", "a published expert requires a family name"],
    ["givenName", "a published expert requires a given name"],
    ["professionalRole", "a published expert requires a professional role"],
    ["credentials", "a published expert requires credentials"],
    ["affiliation", "a published expert requires an affiliation"],
    ["bio", "a published expert requires a bio"],
  ] as const;
  const blockers: { path: string; message: string }[] = [];
  for (const [field, message] of required) {
    const patched = patch[field];
    const value = patched !== undefined ? patched : current[field];
    if (value === null || value === undefined) {
      blockers.push({ path: field, message });
    }
  }
  return blockers;
}

/** Two slot sets are the same when every (link, event, position) triple matches. */
function sameSlotSet(
  a: readonly ExpertEventSlot[],
  b: readonly ExpertEventSlot[],
): boolean {
  if (a.length !== b.length) return false;
  // Both reads come back in the SAME repository-fixed order, so a positional
  // comparison is exact — no re-sorting that could hide a reordering.
  return a.every((slot, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      slot.linkId === other.linkId &&
      slot.eventId === other.eventId &&
      slot.position === other.position
    );
  });
}


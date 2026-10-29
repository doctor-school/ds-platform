import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Organisation } from "@ds/db";
import {
  type AdminTaxonomyListQuery,
  type CreateOrganisationRequest,
  type OrganisationAdminDetail,
  type OrganisationAdminList,
  taxonomyETag,
  type UpdateOrganisationRequest,
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
import { OrganisationsRepository } from "./organisations.repository.js";
import { markReplayable, TaxonomyError } from "./taxonomy.errors.js";
import { allocateTaxonomySlug, taxonomySlugBase } from "./taxonomy-slug.js";

// 012 EARS-4 (#1286) — the partner authoring commands. Same §5.1 failure ORDER
// the project and expert verticals established, against the SAME shared
// services:
//
//   auth (guard) → key shape → fingerprint binding → normalization → upload →
//   domain transaction (precondition recheck → ref swap → audit → fenced record
//   completion).
//
// Only two things are partner-specific: the media slot is `logo`, and the row
// carries an optional absolute-HTTPS `websiteUrl` whose shape is already settled
// by the Zod contract (and re-pinned by a DB CHECK). There is NO
// publish-requirement branch here: §5.2's `PublicPartner` declares `logoUrl` and
// `websiteUrl` nullable, so a published partner with neither is a complete
// projection — inventing a blocker would refuse an edit the product allows.

/** Where partner logos live in the bucket. */
const LOGO_PREFIX = "taxonomy/partners/logos";

export interface CreateOrganisationInput {
  payload: CreateOrganisationRequest;
  logo?: UploadedImage | undefined;
  lease: IdempotencyLease;
}

export interface UpdateOrganisationInput {
  id: string;
  payload: UpdateOrganisationRequest;
  logo?: UploadedImage | undefined;
  expectedVersion: number;
  lease: IdempotencyLease;
}

export interface PublishOrganisationInput {
  id: string;
  expectedVersion: number;
  lease: IdempotencyLease;
}

/** A command result plus the ETag the client must echo on its next write. */
export interface OrganisationCommandResult {
  detail: OrganisationAdminDetail;
  etag: string;
}

@Injectable()
export class OrganisationsService {
  private readonly logger = new Logger(OrganisationsService.name);

  // Explicit @Inject tokens on every dependency, class ones included — the
  // root-level `endpoint-authz` gate boots this module graph under `tsx`, whose
  // esbuild transform emits no `design:paramtypes`, so a type-inferred injection
  // resolves to `undefined` there while working fine under `nest build`.
  constructor(
    @Inject(OrganisationsRepository)
    private readonly repo: OrganisationsRepository,
    @Inject(StillImageNormalizer)
    private readonly normalizer: StillImageNormalizer,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(MediaCleanupService) private readonly cleanup: MediaCleanupService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** `POST /v1/admin/organisations` — create one draft partner. */
  create(input: CreateOrganisationInput): Promise<OrganisationCommandResult> {
    return this.fenced(input.lease, () => this.createCommand(input));
  }

  /** `PATCH /v1/admin/organisations/:id` — edit the SAME row. */
  update(input: UpdateOrganisationInput): Promise<OrganisationCommandResult> {
    return this.fenced(input.lease, () => this.updateCommand(input));
  }

  /** `POST /v1/admin/organisations/:id/publish` — `draft → published` (EARS-5). */
  publish(input: PublishOrganisationInput): Promise<OrganisationCommandResult> {
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
    input: CreateOrganisationInput,
  ): Promise<OrganisationCommandResult> {
    const base = taxonomySlugBase(input.payload.title, "partner");
    const roleIds = input.payload.roleIds ?? [];
    // Optimistic pre-check OUTSIDE the transaction: a doomed request never
    // uploads. The same check repeats under the role locks below.
    await this.assertAssignableRoles(this.repo.db(), roleIds, []);

    const uploaded = input.logo
      ? await this.normalizeAndUpload(input.logo, input.lease)
      : null;

    const row = await this.repo.transaction(async (tx) => {
      await this.repo.lockSlugSequence(tx, base);
      const slug = await allocateTaxonomySlug(base, "partner", (candidate) =>
        this.repo.slugTaken(tx, candidate),
      );
      const created = await this.repo.insert(tx, {
        slug,
        title: input.payload.title,
        websiteUrl: input.payload.websiteUrl ?? null,
        logoRef: uploaded?.key ?? null,
        description: emptyToNull(input.payload.description),
        publicNameVisible: input.payload.publicNameVisible ?? true,
        publicLogoVisible: input.payload.publicLogoVisible ?? true,
      });
      await this.assertAssignableRoles(tx, roleIds, [], true);
      await this.repo.replaceRoles(tx, created.id, roleIds);
      const detail = await this.toDetail(created, tx);
      await this.idempotency.complete(tx, input.lease, {
        status: 201,
        body: detail,
        etag: taxonomyETag(created.version),
        location: `/v1/admin/organisations/${created.id}`,
      });
      return created;
    });

    return {
      detail: await this.toDetail(row),
      etag: taxonomyETag(row.version),
    };
  }

  private async updateCommand(
    input: UpdateOrganisationInput,
  ): Promise<OrganisationCommandResult> {
    const current = await this.repo.findById(input.id);
    if (!current) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    if (current.version !== input.expectedVersion) {
      throw new TaxonomyError(
        "PRECONDITION_FAILED",
        "the organisation changed since it was read; reload and retry",
      );
    }

    const roleIds = input.payload.roleIds;
    if (roleIds !== undefined) {
      await this.assertAssignableRoles(
        this.repo.db(),
        roleIds,
        await this.repo.heldRoleIds(this.repo.db(), input.id),
      );
    }

    const uploaded = input.logo
      ? await this.normalizeAndUpload(input.logo, input.lease)
      : null;
    const clearing = input.payload.mediaAction === "clear";
    const releasedRef =
      (uploaded || clearing) && current.logoRef ? current.logoRef : null;

    const row = await this.repo.transaction(async (tx) => {
      // Re-read under the row lock: everything above was optimistic.
      const locked = await this.repo.lockById(tx, input.id);
      if (!locked) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      if (locked.version !== input.expectedVersion) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the organisation changed since it was read; reload and retry",
        );
      }
      if (roleIds !== undefined) {
        await this.assertAssignableRoles(
          tx,
          roleIds,
          await this.repo.heldRoleIds(tx, input.id),
          true,
        );
      }
      const updated = await this.repo.updateVersioned(
        tx,
        input.id,
        input.expectedVersion,
        {
          ...(input.payload.title !== undefined
            ? { title: input.payload.title }
            : {}),
          ...(input.payload.websiteUrl !== undefined
            ? { websiteUrl: input.payload.websiteUrl ?? null }
            : {}),
          ...(input.payload.description !== undefined
            ? { description: emptyToNull(input.payload.description) }
            : {}),
          ...(input.payload.publicNameVisible !== undefined
            ? { publicNameVisible: input.payload.publicNameVisible }
            : {}),
          ...(input.payload.publicLogoVisible !== undefined
            ? { publicLogoVisible: input.payload.publicLogoVisible }
            : {}),
          ...(uploaded ? { logoRef: uploaded.key } : {}),
          ...(clearing && !uploaded ? { logoRef: null } : {}),
        },
      );
      if (!updated) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the organisation changed since it was read; reload and retry",
        );
      }
      // EARS-2: the set is replaced in the SAME versioned transaction, so the
      // row's version moves with its roles and feature 010 attributes both.
      if (roleIds !== undefined) {
        await this.repo.replaceRoles(tx, updated.id, roleIds);
      }
      // The released object's deletion obligation is durable and rides the SAME
      // transaction as the ref change (012-design §5.1).
      if (releasedRef && releasedRef !== updated.logoRef) {
        await this.cleanup.enqueue(tx, {
          cleanupKind: uploaded ? "replace" : "clear",
          entityKind: "partner",
          entityId: updated.id,
          slot: "logo",
          objectKey: releasedRef,
        });
      }
      const detail = await this.toDetail(updated, tx);
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
   * `draft → published`, with `first_published_at` stamped ONCE (LD-3).
   *
   * There is NO completeness branch and no relation invariant here, and that is
   * the decision rather than an omission: `title` is NOT NULL and the PATCH
   * contract refuses a null one, while §5.2 declares both `logoUrl` and
   * `websiteUrl` nullable on `PublicPartner`. So a partner with a title alone is
   * already a complete public projection, and a partner with zero project links
   * is an ordinary one. Inventing a blocker would refuse what the product allows.
   *
   * The publish is therefore a single-row lifecycle move, and needs no lock set
   * beyond its own row — unlike a project (curator) or an expert (speaker slots).
   */
  private async publishCommand(
    input: PublishOrganisationInput,
  ): Promise<OrganisationCommandResult> {
    // Optimistic pre-flight OUTSIDE the transaction: a doomed request never
    // opens one. Every check below repeats under the lock.
    const current = await this.repo.findById(input.id);
    if (!current) throw new TaxonomyError("RESOURCE_NOT_FOUND");

    const row = await this.repo.transaction(async (tx) => {
      const locked = await this.repo.lockById(tx, input.id);
      if (!locked) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      if (locked.version !== input.expectedVersion) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the organisation changed since it was read; reload and retry",
        );
      }
      if (locked.status !== "draft") {
        throw new TaxonomyError(
          "INVALID_TRANSITION",
          locked.status === "published"
            ? "this partner is already published"
            : "this partner is retired; restore it before publishing it again",
        );
      }

      const moved = await this.repo.transitionVersioned(
        tx,
        input.id,
        input.expectedVersion,
        {
          status: "published",
          deletedAt: null,
          // Set ONCE and never re-stamped: a republished partner keeps the date
          // it first became public, which is what pins its slug (LD-3).
          ...(locked.firstPublishedAt ? {} : { firstPublishedAt: new Date() }),
        },
      );
      if (!moved) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the organisation changed since it was read; reload and retry",
        );
      }
      const detail = await this.toDetail(moved, tx);
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

  /** `GET /v1/admin/organisations/:id` — detail by stable id, retired rows included. */
  async detail(id: string): Promise<OrganisationCommandResult> {
    const row = await this.repo.findById(id);
    if (!row) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    return {
      detail: await this.toDetail(row),
      etag: taxonomyETag(row.version),
    };
  }

  /** `GET /v1/admin/organisations` — the shared admin list with LD-6 title search. */
  async list(query: AdminTaxonomyListQuery): Promise<OrganisationAdminList> {
    const { rows, total } = await this.repo.list(query);
    const roles = await this.repo.rolesFor(
      this.repo.db(),
      rows.map((row) => row.id),
    );
    return {
      data: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        websiteUrl: row.websiteUrl,
        roles: roles.get(row.id) ?? [],
        status: row.status,
        version: row.version,
        updatedAt: row.updatedAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * Normalize the upload and PUT the canonical bytes under a deterministic,
   * record-scoped key with write-once semantics. Byte-for-byte the project
   * vertical's flow against the SAME shared normalizer — a logo is not a
   * different kind of still image, so there is no second decoder and no
   * partner-specific media profile (012-design §2.2).
   */
  private async normalizeAndUpload(
    logo: UploadedImage,
    lease: IdempotencyLease,
  ): Promise<{ key: string; normalized: NormalizedImage }> {
    const normalized = await this.normalizer.normalize(logo);
    const key = this.idempotency.objectKeyFor({
      lease,
      prefix: LOGO_PREFIX,
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
        this.logger.log(`logo object ${key} already present — resumed request`);
        return { key, normalized };
      }
      this.logger.error(
        `object storage refused the logo PUT: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new TaxonomyError(
        "MEDIA_STORAGE_UNAVAILABLE",
        "the logo could not be stored; no partner data changed",
      );
    }
    return { key, normalized };
  }

  /**
   * EARS-2 — every requested role must exist and be active, or be one the
   * organisation already holds (a retired held role stays assignable, so an
   * unrelated edit never forces its removal). `locked` re-reads FOR SHARE
   * inside the transaction, so a role validated there cannot be retired under it.
   */
  private async assertAssignableRoles(
    tx: Parameters<OrganisationsRepository["lockRoles"]>[0],
    roleIds: readonly string[],
    held: readonly string[],
    locked = false,
  ): Promise<void> {
    if (roleIds.length === 0) return;
    const found = locked
      ? await this.repo.lockRoles(tx, roleIds)
      : await this.repo.readRoles(tx, roleIds);
    const status = new Map(found.map((r) => [r.id, r.status]));
    const refused = roleIds.filter(
      (id) =>
        !status.has(id) || (status.get(id) !== "active" && !held.includes(id)),
    );
    if (refused.length > 0) {
      throw new TaxonomyError(
        "VALIDATION_FAILED",
        "a role is unknown or retired",
        [
          {
            path: "roleIds",
            message: "a role is unknown or retired; choose an active role",
          },
        ],
      );
    }
  }

  private async toDetail(
    row: Organisation,
    tx?: Parameters<OrganisationsRepository["lockRoles"]>[0],
  ): Promise<OrganisationAdminDetail> {
    const roles = await this.repo.rolesFor(tx ?? this.repo.db(), [row.id]);
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      logoUrl: row.logoRef ? await this.storage.urlFor(row.logoRef) : null,
      websiteUrl: row.websiteUrl,
      description: row.description,
      publicNameVisible: row.publicNameVisible,
      publicLogoVisible: row.publicLogoVisible,
      roles: roles.get(row.id) ?? [],
      status: row.status,
      firstPublishedAt: row.firstPublishedAt?.toISOString() ?? null,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/** EARS-1 — an empty description clears it; absent/null stays null. */
function emptyToNull(value: string | null | undefined): string | null {
  return value ? value : null;
}

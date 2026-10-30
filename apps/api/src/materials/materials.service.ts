import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Material } from "@ds/db";
import {
  type AdminMaterialListQuery,
  type CreateMaterialRequest,
  emptyMaterialBody,
  expertDisplayName,
  type MaterialAdminDetail,
  type MaterialAdminList,
  materialAuthorIssues,
  type MaterialBody,
  materialPublishMissing,
  taxonomyETag,
  type UpdateMaterialRequest,
} from "@ds/schemas";
import {
  OBJECT_STORAGE,
  ObjectAlreadyExistsError,
  type ObjectStorage,
} from "../storage/index.js";
import {
  type IdempotencyLease,
  IdempotencyService,
  markReplayable,
  MediaCleanupService,
  StillImageNormalizer,
  TaxonomyError,
  type UploadedImage,
} from "../taxonomy/index.js";
import { allocateMaterialSlug, materialSlugBase } from "./materials-slug.js";
import {
  type MaterialPatch,
  MaterialsRepository,
  type MaterialsTx,
} from "./materials.repository.js";
import { OwnMaterialsFeedSource } from "./own-materials.feed-source.js";

// 048 (#3512) — the «Материалы» authoring commands (EARS-1, EARS-4…EARS-8,
// EARS-19). Same failure ORDER and the SAME shared services as the 012/032
// verticals: guard → key shape → fingerprint binding → one audit-attributed
// domain transaction (row lock → precondition → validation → write → feed
// entry → fenced record completion). A refused write changes nothing: every
// check runs before the first statement that writes.

type FieldError = { path: string; message: string };

export interface CreateMaterialInput {
  payload: CreateMaterialRequest;
  cover?: UploadedImage | undefined;
  lease: IdempotencyLease;
}

export interface UpdateMaterialInput {
  id: string;
  payload: UpdateMaterialRequest;
  cover?: UploadedImage | undefined;
  expectedVersion: number;
  lease: IdempotencyLease;
}

export interface MaterialLifecycleInput {
  id: string;
  expectedVersion: number;
  lease: IdempotencyLease;
}

export interface MaterialCommandResult {
  detail: MaterialAdminDetail;
  etag: string;
}

const STALE = "the material changed since it was read; reload and retry";

/** Where material covers live in the bucket. */
const COVER_PREFIX = "materials/covers";

@Injectable()
export class MaterialsService {
  private readonly logger = new Logger(MaterialsService.name);

  // Explicit @Inject tokens — the endpoint-authz gate boots this graph under
  // `tsx`, which emits no `design:paramtypes` (see organisations.service.ts).
  constructor(
    @Inject(MaterialsRepository) private readonly repo: MaterialsRepository,
    @Inject(OwnMaterialsFeedSource)
    private readonly feed: OwnMaterialsFeedSource,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(StillImageNormalizer)
    private readonly normalizer: StillImageNormalizer,
    @Inject(MediaCleanupService) private readonly cleanup: MediaCleanupService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  create(input: CreateMaterialInput): Promise<MaterialCommandResult> {
    return this.fenced(input.lease, () => this.createCommand(input));
  }

  update(input: UpdateMaterialInput): Promise<MaterialCommandResult> {
    return this.fenced(input.lease, () => this.updateCommand(input));
  }

  publish(input: MaterialLifecycleInput): Promise<MaterialCommandResult> {
    return this.fenced(input.lease, () => this.publishCommand(input));
  }

  unpublish(input: MaterialLifecycleInput): Promise<MaterialCommandResult> {
    return this.fenced(input.lease, () => this.unpublishCommand(input));
  }

  /** Tag a deterministic refusal with its record, so an exact retry replays it. */
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

  /** EARS-1 — a new material is a draft. */
  private async createCommand(
    input: CreateMaterialInput,
  ): Promise<MaterialCommandResult> {
    const { payload } = input;
    const kind = payload.kind;
    const expertId = kind === "column" ? (payload.expertId ?? null) : null;
    const partnerOrganisationId = payload.partnerOrganisationId ?? null;
    // Normalization and the PUT run BEFORE the transaction (012 §5.1 order): a
    // refused image writes no row, and a later refusal leaves only a noted
    // locator the upload reconciler reclaims.
    const coverRef = input.cover
      ? await this.normalizeAndUpload(input.cover, input.lease)
      : null;
    return this.repo.transaction(async (tx) => {
      await this.assertReferences(tx, { expertId, partnerOrganisationId });
      const base = materialSlugBase(payload.title);
      await this.repo.lockSlugSequence(tx, base);
      const slug = await allocateMaterialSlug(base, (c) =>
        this.repo.slugTaken(tx, c),
      );
      const created = await this.repo.insert(tx, {
        slug,
        kind,
        title: payload.title,
        authorLine: kind === "news" ? (payload.authorLine ?? "") : "",
        expertId,
        partnerOrganisationId,
        body: payload.body ?? emptyMaterialBody(),
        coverRef,
      });
      return this.complete(tx, input.lease, created, 201);
    });
  }

  /**
   * EARS-1 / EARS-5 / EARS-19 — edit the same row under its `If-Match`. The
   * kind-dependent author rule is checked on the merged state; a published
   * material keeps the publish set of title and body text (the column expert's
   * published state is NOT re-checked, Lead decision 11) and its feed entry is
   * rewritten in the same transaction.
   */
  private async updateCommand(
    input: UpdateMaterialInput,
  ): Promise<MaterialCommandResult> {
    const { payload } = input;
    // Optimistic pre-check OUTSIDE the transaction, so a doomed request never
    // uploads; the same check repeats under the row lock below.
    const seen = await this.repo.findById(input.id);
    if (!seen) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    if (seen.version !== input.expectedVersion) {
      throw new TaxonomyError("PRECONDITION_FAILED", STALE);
    }
    const uploadedRef = input.cover
      ? await this.normalizeAndUpload(input.cover, input.lease)
      : null;
    const clearing = payload.mediaAction === "clear";
    return this.repo.transaction(async (tx) => {
      const current = await this.lockVersion(
        tx,
        input.id,
        input.expectedVersion,
      );

      const kind = payload.kind ?? current.kind;
      const expertId =
        payload.expertId !== undefined
          ? payload.expertId
          : kind === "news"
            ? null
            : current.expertId;
      const partnerOrganisationId =
        payload.partnerOrganisationId !== undefined
          ? payload.partnerOrganisationId
          : current.partnerOrganisationId;
      const title = payload.title ?? current.title;
      const body = (payload.body ?? current.body) as MaterialBody;
      const authorLine =
        kind === "column"
          ? ""
          : (payload.authorLine ??
            (current.kind === "news" ? current.authorLine : ""));

      const authorIssues = materialAuthorIssues({ kind, expertId });
      if (authorIssues.length > 0) throw validation(authorIssues);
      await this.assertReferences(tx, {
        // Only a CHANGED reference is re-validated: an unrelated edit never
        // forces out an expert or a partner that has since been retired.
        expertId: expertId !== current.expertId ? expertId : null,
        partnerOrganisationId:
          partnerOrganisationId !== current.partnerOrganisationId
            ? partnerOrganisationId
            : null,
      });
      if (current.status === "published") {
        const missing = materialPublishMissing({
          kind,
          title,
          body,
          expertPublished: null,
        });
        if (missing.length > 0) throw publishRefused(missing);
      }

      const patch: MaterialPatch = {
        kind,
        title,
        authorLine,
        expertId,
        partnerOrganisationId,
        body,
        ...(uploadedRef ? { coverRef: uploadedRef } : {}),
        ...(clearing && !uploadedRef ? { coverRef: null } : {}),
      };
      // The slug follows the title until the first publish freezes it.
      if (!current.firstPublishedAt && title !== current.title) {
        const base = materialSlugBase(title);
        await this.repo.lockSlugSequence(tx, base);
        patch.slug = await allocateMaterialSlug(base, (c) =>
          this.repo.slugTaken(tx, c, current.id),
        );
      }
      const updated = await this.repo.updateVersioned(
        tx,
        current.id,
        input.expectedVersion,
        patch,
      );
      if (!updated) throw new TaxonomyError("PRECONDITION_FAILED", STALE);
      // The released object's deletion obligation is durable and rides the SAME
      // transaction as the reference change (012-design §5.1).
      const releasedRef =
        (uploadedRef || clearing) && current.coverRef ? current.coverRef : null;
      if (releasedRef && releasedRef !== updated.coverRef) {
        await this.cleanup.enqueue(tx, {
          cleanupKind: uploadedRef ? "replace" : "clear",
          entityKind: "material",
          entityId: updated.id,
          slot: "cover",
          objectKey: releasedRef,
        });
      }
      if (updated.status === "published") {
        await this.feed.write(tx, updated, await this.coverUrlOf(updated));
      }
      return this.complete(tx, input.lease, updated, 200);
    });
  }

  /**
   * EARS-4 — `draft → published` with the requirement set; `first_published_at`
   * is set once (a re-publish keeps it, EARS-6) and the feed entry is written
   * in the same transaction.
   */
  private async publishCommand(
    input: MaterialLifecycleInput,
  ): Promise<MaterialCommandResult> {
    return this.repo.transaction(async (tx) => {
      const current = await this.lockVersion(
        tx,
        input.id,
        input.expectedVersion,
      );
      if (current.status !== "draft") {
        throw new TaxonomyError(
          "INVALID_TRANSITION",
          "this material is already published",
        );
      }
      let expertPublished: boolean | null = null;
      if (current.kind === "column" && current.expertId) {
        const expert = await this.repo.readExpert(tx, current.expertId, true);
        expertPublished = expert?.status === "published";
      }
      const missing = materialPublishMissing({
        kind: current.kind,
        title: current.title,
        body: current.body as MaterialBody,
        expertPublished,
      });
      if (missing.length > 0) throw publishRefused(missing);

      const moved = await this.repo.updateVersioned(
        tx,
        current.id,
        input.expectedVersion,
        {
          status: "published",
          ...(current.firstPublishedAt ? {} : { firstPublishedAt: new Date() }),
        },
      );
      if (!moved) throw new TaxonomyError("PRECONDITION_FAILED", STALE);
      await this.feed.write(tx, moved, await this.coverUrlOf(moved));
      return this.complete(tx, input.lease, moved, 200);
    });
  }

  /** EARS-6 — back to draft with the content kept; the feed entry is removed. */
  private async unpublishCommand(
    input: MaterialLifecycleInput,
  ): Promise<MaterialCommandResult> {
    return this.repo.transaction(async (tx) => {
      const current = await this.lockVersion(
        tx,
        input.id,
        input.expectedVersion,
      );
      if (current.status !== "published") {
        throw new TaxonomyError(
          "INVALID_TRANSITION",
          "this material is not published",
        );
      }
      const moved = await this.repo.updateVersioned(
        tx,
        current.id,
        input.expectedVersion,
        {
          status: "draft",
        },
      );
      if (!moved) throw new TaxonomyError("PRECONDITION_FAILED", STALE);
      await this.feed.remove(tx, moved);
      return this.complete(tx, input.lease, moved, 200);
    });
  }

  /** `GET /v1/admin/materials/:id` — the form's read plus its ETag. */
  async detail(id: string): Promise<MaterialCommandResult> {
    const row = await this.repo.findById(id);
    if (!row) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    return {
      detail: await this.toDetail(this.repo.db(), row),
      etag: taxonomyETag(row.version),
    };
  }

  /** EARS-7 — `GET /v1/admin/materials`. */
  async list(query: AdminMaterialListQuery): Promise<MaterialAdminList> {
    const { rows, total } = await this.repo.list(query);
    return {
      data: rows.map(({ material, expert }) => ({
        id: material.id,
        slug: material.slug,
        kind: material.kind,
        title: material.title,
        status: material.status,
        firstPublishedAt: material.firstPublishedAt?.toISOString() ?? null,
        author:
          material.kind === "news"
            ? material.authorLine || null
            : expert
              ? expertDisplayName(expert)
              : null,
        // «Не на сайте: эксперт не опубликован» — judged now, as the reads do.
        expertNotPublished:
          material.kind === "column" &&
          material.status === "published" &&
          expert?.status !== "published",
        version: material.version,
        updatedAt: material.updatedAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Lock the row and assert the caller's version (412 when it moved). */
  private async lockVersion(
    tx: MaterialsTx,
    id: string,
    expectedVersion: number,
  ): Promise<Material> {
    const row = await this.repo.lockById(tx, id);
    if (!row) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    if (row.version !== expectedVersion) {
      throw new TaxonomyError("PRECONDITION_FAILED", STALE);
    }
    return row;
  }

  /**
   * EARS-1 / EARS-19 — a referenced expert or partner must exist and not be
   * retired, read FOR SHARE so it cannot be retired under this transaction.
   */
  private async assertReferences(
    tx: MaterialsTx,
    refs: { expertId: string | null; partnerOrganisationId: string | null },
  ): Promise<void> {
    const errors: FieldError[] = [];
    if (refs.expertId) {
      const expert = await this.repo.readExpert(tx, refs.expertId, true);
      if (!expert || expert.status === "retired") {
        errors.push({
          path: "expertId",
          message: "the expert is unknown or retired; choose a current expert",
        });
      }
    }
    if (refs.partnerOrganisationId) {
      const organisation = await this.repo.readOrganisation(
        tx,
        refs.partnerOrganisationId,
        true,
      );
      if (!organisation || organisation.status === "retired") {
        errors.push({
          path: "partnerOrganisationId",
          message:
            "the organisation is unknown or retired; choose a current one",
        });
      }
    }
    if (errors.length > 0) throw validation(errors);
  }

  /** Complete the idempotency record in the command's transaction. */
  private async complete(
    tx: MaterialsTx,
    lease: IdempotencyLease,
    row: Material,
    status: 200 | 201,
  ): Promise<MaterialCommandResult> {
    const detail = await this.toDetail(tx, row);
    const etag = taxonomyETag(row.version);
    await this.idempotency.complete(tx, lease, {
      status,
      body: detail,
      etag,
      ...(status === 201 ? { location: `/v1/admin/materials/${row.id}` } : {}),
    });
    return { detail, etag };
  }

  /** The cover's URL from object storage, or `null` without a cover. */
  private async coverUrlOf(row: Material): Promise<string | null> {
    return row.coverRef ? this.storage.urlFor(row.coverRef) : null;
  }

  /**
   * Normalize the cover and PUT the canonical WebP under a deterministic,
   * record-scoped key with write-once semantics — the 012 project/partner flow
   * against the SAME shared normalizer (012-design §2.2): a cover is not a
   * different kind of still image.
   */
  private async normalizeAndUpload(
    cover: UploadedImage,
    lease: IdempotencyLease,
  ): Promise<string> {
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
        return key;
      }
      this.logger.error(
        `object storage refused the cover PUT: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new TaxonomyError(
        "MEDIA_STORAGE_UNAVAILABLE",
        "the cover could not be stored; no material data changed",
      );
    }
    return key;
  }

  private async toDetail(
    tx: Parameters<MaterialsRepository["readExpert"]>[0],
    row: Material,
  ): Promise<MaterialAdminDetail> {
    const expert = row.expertId
      ? await this.repo.readExpert(tx, row.expertId)
      : null;
    const partner = row.partnerOrganisationId
      ? await this.repo.readOrganisation(tx, row.partnerOrganisationId)
      : null;
    return {
      id: row.id,
      slug: row.slug,
      kind: row.kind,
      title: row.title,
      authorLine: row.authorLine,
      expert: expert
        ? {
            id: expert.id,
            name: expertDisplayName(expert),
            status: expert.status,
          }
        : null,
      partner: partner
        ? { id: partner.id, title: partner.title, status: partner.status }
        : null,
      coverUrl: await this.coverUrlOf(row),
      body: row.body as MaterialBody,
      status: row.status,
      firstPublishedAt: row.firstPublishedAt?.toISOString() ?? null,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}


function validation(errors: FieldError[]): TaxonomyError {
  return new TaxonomyError(
    "VALIDATION_FAILED",
    "invalid material payload",
    errors,
  );
}

function publishRefused(errors: FieldError[]): TaxonomyError {
  return new TaxonomyError(
    "PUBLISH_REQUIREMENTS_NOT_MET",
    "the material is missing what publication requires",
    errors,
  );
}

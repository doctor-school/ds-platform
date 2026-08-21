import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Partner } from "@ds/db";
import {
  type AdminTaxonomyListQuery,
  type CreatePartnerRequest,
  type PartnerAdminDetail,
  type PartnerAdminList,
  slugifyTaxonomyTitle,
  SlugSchema,
  taxonomyETag,
  type UpdatePartnerRequest,
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
import { PartnersRepository } from "./partners.repository.js";
import { markReplayable, TaxonomyError } from "./taxonomy.errors.js";

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

export interface CreatePartnerInput {
  payload: CreatePartnerRequest;
  logo?: UploadedImage | undefined;
  lease: IdempotencyLease;
}

export interface UpdatePartnerInput {
  id: string;
  payload: UpdatePartnerRequest;
  logo?: UploadedImage | undefined;
  expectedVersion: number;
  lease: IdempotencyLease;
}

/** A command result plus the ETag the client must echo on its next write. */
export interface PartnerCommandResult {
  detail: PartnerAdminDetail;
  etag: string;
}

@Injectable()
export class PartnersService {
  private readonly logger = new Logger(PartnersService.name);

  // Explicit @Inject tokens on every dependency, class ones included — the
  // root-level `endpoint-authz` gate boots this module graph under `tsx`, whose
  // esbuild transform emits no `design:paramtypes`, so a type-inferred injection
  // resolves to `undefined` there while working fine under `nest build`.
  constructor(
    @Inject(PartnersRepository) private readonly repo: PartnersRepository,
    @Inject(StillImageNormalizer)
    private readonly normalizer: StillImageNormalizer,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(MediaCleanupService) private readonly cleanup: MediaCleanupService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** `POST /v1/admin/partners` — create one draft partner. */
  create(input: CreatePartnerInput): Promise<PartnerCommandResult> {
    return this.fenced(input.lease, () => this.createCommand(input));
  }

  /** `PATCH /v1/admin/partners/:id` — edit the SAME row. */
  update(input: UpdatePartnerInput): Promise<PartnerCommandResult> {
    return this.fenced(input.lease, () => this.updateCommand(input));
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
    input: CreatePartnerInput,
  ): Promise<PartnerCommandResult> {
    const slug = this.resolveCreateSlug(input.payload);
    // Pre-flight the conflict OUTSIDE the transaction so a doomed request never
    // normalizes or uploads; the unique index still guards the race.
    if (await this.repo.slugTakenAnywhere(slug)) {
      throw new TaxonomyError(
        "SLUG_CONFLICT",
        "another partner already holds this slug; restore that record instead of re-creating it",
      );
    }

    const uploaded = input.logo
      ? await this.normalizeAndUpload(input.logo, input.lease)
      : null;

    const row = await this.repo.transaction(async (tx) => {
      if (await this.repo.slugTaken(tx, slug)) {
        throw new TaxonomyError(
          "SLUG_CONFLICT",
          "another partner already holds this slug; restore that record instead of re-creating it",
        );
      }
      const created = await this.repo.insert(tx, {
        slug,
        title: input.payload.title,
        websiteUrl: input.payload.websiteUrl ?? null,
        logoRef: uploaded?.key ?? null,
      });
      const detail = await this.toDetail(created);
      await this.idempotency.complete(tx, input.lease, {
        status: 201,
        body: detail,
        etag: taxonomyETag(created.version),
        location: `/v1/admin/partners/${created.id}`,
      });
      return created;
    });

    return { detail: await this.toDetail(row), etag: taxonomyETag(row.version) };
  }

  private async updateCommand(
    input: UpdatePartnerInput,
  ): Promise<PartnerCommandResult> {
    const current = await this.repo.findById(input.id);
    if (!current) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    if (current.version !== input.expectedVersion) {
      throw new TaxonomyError(
        "PRECONDITION_FAILED",
        "the partner changed since it was read; reload and retry",
      );
    }

    // Slug immutability is a ROW-state refusal, not a shape one, and it is
    // checked before any upload. Echoing the current value is not an update:
    // the admin form posts the whole «Основное» tab, so refusing the echo would
    // block every ordinary edit of a published partner over an untouched field.
    const slugChanges =
      input.payload.slug !== undefined && input.payload.slug !== current.slug;
    if (slugChanges) {
      if (current.firstPublishedAt !== null) {
        throw new TaxonomyError(
          "SLUG_IMMUTABLE",
          "the slug was locked by the first publication and cannot change",
        );
      }
      if (await this.repo.slugTakenAnywhere(input.payload.slug!, current.id)) {
        throw new TaxonomyError(
          "SLUG_CONFLICT",
          "another partner already holds this slug",
        );
      }
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
          "the partner changed since it was read; reload and retry",
        );
      }
      if (
        input.payload.slug !== undefined &&
        input.payload.slug !== locked.slug &&
        locked.firstPublishedAt !== null
      ) {
        throw new TaxonomyError(
          "SLUG_IMMUTABLE",
          "the slug was locked by the first publication and cannot change",
        );
      }

      const updated = await this.repo.updateVersioned(
        tx,
        input.id,
        input.expectedVersion,
        {
          ...(slugChanges ? { slug: input.payload.slug! } : {}),
          ...(input.payload.title !== undefined
            ? { title: input.payload.title }
            : {}),
          ...(input.payload.websiteUrl !== undefined
            ? { websiteUrl: input.payload.websiteUrl ?? null }
            : {}),
          ...(uploaded ? { logoRef: uploaded.key } : {}),
          ...(clearing && !uploaded ? { logoRef: null } : {}),
        },
      );
      if (!updated) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the partner changed since it was read; reload and retry",
        );
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

  /** `GET /v1/admin/partners/:id` — detail by stable id, retired rows included. */
  async detail(id: string): Promise<PartnerCommandResult> {
    const row = await this.repo.findById(id);
    if (!row) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    return { detail: await this.toDetail(row), etag: taxonomyETag(row.version) };
  }

  /** `GET /v1/admin/partners` — the shared admin list with LD-6 title search. */
  async list(query: AdminTaxonomyListQuery): Promise<PartnerAdminList> {
    const { rows, total } = await this.repo.list(query);
    return {
      data: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        websiteUrl: row.websiteUrl,
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

  /** Resolve the create-time slug: the authored one, or generated from the title. */
  private resolveCreateSlug(payload: CreatePartnerRequest): string {
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

  private async toDetail(row: Partner): Promise<PartnerAdminDetail> {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      logoUrl: row.logoRef ? await this.storage.urlFor(row.logoRef) : null,
      websiteUrl: row.websiteUrl,
      status: row.status,
      firstPublishedAt: row.firstPublishedAt?.toISOString() ?? null,
      slugEditable: row.firstPublishedAt === null,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

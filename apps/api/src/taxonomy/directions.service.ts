import { Inject, Injectable } from "@nestjs/common";
import type { Direction } from "@ds/db";
import {
  type AdminTaxonomyListQuery,
  type CreateDirectionRequest,
  slugifyTaxonomyTitle,
  SlugSchema,
  taxonomyETag,
  type DirectionAdminDetail,
  type DirectionAdminList,
  type UpdateDirectionRequest,
} from "@ds/schemas";
import { DirectionsRepository } from "./directions.repository.js";
import {
  type IdempotencyLease,
  IdempotencyService,
} from "./idempotency.service.js";
import { markReplayable, TaxonomyError } from "./taxonomy.errors.js";

// 012 EARS-3 (#1285) — the curated direction authoring commands. The same §5.1
// failure ORDER the project and expert verticals established, minus the media
// stages this entity has none of:
//
//   auth (guard) → key shape → fingerprint binding → domain transaction
//   (precondition recheck → write → audit → fenced record completion).
//
// A direction is a first-class retained record, never a free-form event tag: this
// service is the ONLY way a `directions` row comes into existence, so there is no
// inline creation path from an event form and no per-event string that could
// become a second spelling of the same subject. Classifying an event is the
// separate `event_directions` link of #1293.
//
// There is deliberately no publish-requirement check here as the sibling
// verticals have: `title` is NOT NULL in the schema and the PATCH contract
// refuses a null one, so a direction can never be edited into an incomplete public
// projection — §5.2's `PublicDirection` is exactly `{ id, slug, title }`.

export interface CreateDirectionInput {
  payload: CreateDirectionRequest;
  lease: IdempotencyLease;
}

export interface UpdateDirectionInput {
  id: string;
  payload: UpdateDirectionRequest;
  expectedVersion: number;
  lease: IdempotencyLease;
}

/** A command result plus the ETag the client must echo on its next write. */
export interface DirectionCommandResult {
  detail: DirectionAdminDetail;
  etag: string;
}

@Injectable()
export class DirectionsService {
  // Explicit @Inject tokens on every dependency, class ones included — the
  // root-level `endpoint-authz` gate boots this module graph under `tsx`, whose
  // esbuild transform emits no `design:paramtypes`, so a type-inferred injection
  // resolves to `undefined` there while working fine under `nest build`.
  constructor(
    @Inject(DirectionsRepository) private readonly repo: DirectionsRepository,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  /** `POST /v1/admin/directions` — create one draft direction. */
  create(input: CreateDirectionInput): Promise<DirectionCommandResult> {
    return this.fenced(input.lease, () => this.createCommand(input));
  }

  /** `PATCH /v1/admin/directions/:id` — edit the SAME row. */
  update(input: UpdateDirectionInput): Promise<DirectionCommandResult> {
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
    input: CreateDirectionInput,
  ): Promise<DirectionCommandResult> {
    const slug = this.resolveCreateSlug(input.payload);
    // Pre-flight the conflict OUTSIDE the transaction so a doomed request never
    // opens one; the unique index still guards the race.
    if (await this.repo.slugTakenAnywhere(slug)) {
      throw new TaxonomyError(
        "SLUG_CONFLICT",
        "another direction already holds this slug; restore that record instead of re-creating it",
      );
    }

    const row = await this.repo.transaction(async (tx) => {
      if (await this.repo.slugTaken(tx, slug)) {
        throw new TaxonomyError(
          "SLUG_CONFLICT",
          "another direction already holds this slug; restore that record instead of re-creating it",
        );
      }
      const created = await this.repo.insert(tx, {
        slug,
        title: input.payload.title,
      });
      await this.idempotency.complete(tx, input.lease, {
        status: 201,
        body: toDetail(created),
        etag: taxonomyETag(created.version),
        location: `/v1/admin/directions/${created.id}`,
      });
      return created;
    });

    return { detail: toDetail(row), etag: taxonomyETag(row.version) };
  }

  private async updateCommand(
    input: UpdateDirectionInput,
  ): Promise<DirectionCommandResult> {
    const current = await this.repo.findById(input.id);
    if (!current) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    if (current.version !== input.expectedVersion) {
      throw new TaxonomyError(
        "PRECONDITION_FAILED",
        "the direction changed since it was read; reload and retry",
      );
    }

    // Slug immutability is a ROW-state refusal, not a shape one. Echoing the
    // current value is not an update: the admin form posts the whole «Основное»
    // tab, so refusing the echo would block every ordinary edit of a published
    // direction over an untouched field.
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
          "another direction already holds this slug",
        );
      }
    }

    const row = await this.repo.transaction(async (tx) => {
      // Re-read under the row lock: everything above was optimistic.
      const locked = await this.repo.lockById(tx, input.id);
      if (!locked) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      if (locked.version !== input.expectedVersion) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the direction changed since it was read; reload and retry",
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
        },
      );
      if (!updated) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the direction changed since it was read; reload and retry",
        );
      }
      await this.idempotency.complete(tx, input.lease, {
        status: 200,
        body: toDetail(updated),
        etag: taxonomyETag(updated.version),
      });
      return updated;
    });

    return { detail: toDetail(row), etag: taxonomyETag(row.version) };
  }

  /** `GET /v1/admin/directions/:id` — detail by stable id, retired rows included. */
  async detail(id: string): Promise<DirectionCommandResult> {
    const row = await this.repo.findById(id);
    if (!row) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    return { detail: toDetail(row), etag: taxonomyETag(row.version) };
  }

  /** `GET /v1/admin/directions` — the shared admin list with LD-6 title search. */
  async list(query: AdminTaxonomyListQuery): Promise<DirectionAdminList> {
    const { rows, total } = await this.repo.list(query);
    return {
      data: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
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

  /** Resolve the create-time slug: the authored one, or generated from the title. */
  private resolveCreateSlug(payload: CreateDirectionRequest): string {
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
}

/**
 * The admin projection. Synchronous — unlike a project or an expert there is no
 * storage key to resolve into a signed URL, because a direction has no media.
 */
function toDetail(row: Direction): DirectionAdminDetail {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    firstPublishedAt: row.firstPublishedAt?.toISOString() ?? null,
    slugEditable: row.firstPublishedAt === null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

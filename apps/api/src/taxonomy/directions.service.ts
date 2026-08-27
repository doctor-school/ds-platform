import { Inject, Injectable } from "@nestjs/common";
import type { Direction } from "@ds/db";
import {
  type AdminTaxonomyListQuery,
  type CreateDirectionRequest,
  slugifyTaxonomyTitle,
  SlugSchema,
  TAXONOMY_SLUG_ATTEMPT_LIMIT,
  taxonomySlugCandidate,
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
    const base = this.deriveBaseSlug(input.payload.title);

    const row = await this.repo.transaction(async (tx) => {
      // The address is DERIVED, so a taken candidate is not a refusal the
      // operator could act on — they never chose it. Walk the deterministic
      // candidate sequence inside the transaction (the unique index remains the
      // final race guard) instead of answering a 409 for a decision the server
      // made on the operator's behalf.
      const slug = await this.resolveFreeSlug(tx, base);
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

    // No slug branch here at all: the address never arrives from the operator
    // (017-design §9.3), so a PATCH cannot move the public identity of a
    // direction — published or not. Retitling a direction leaves its address
    // where it was, which is the point: the URL a doctor bookmarked outlives an
    // editorial rewording of the title above it.

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
      const updated = await this.repo.updateVersioned(
        tx,
        input.id,
        input.expectedVersion,
        {
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

  /**
   * Fold the authored Russian title into the base address.
   *
   * A title that yields nothing sluggable at all (only emoji, only punctuation)
   * is refused against `title`, the field the operator actually typed — there is
   * no `slug` input left to point them at, and inventing an identity for a
   * permanent public URL is worse than asking for a real title.
   */
  private deriveBaseSlug(title: string): string {
    const parsed = SlugSchema.safeParse(slugifyTaxonomyTitle(title));
    if (!parsed.success) {
      throw new TaxonomyError(
        "VALIDATION_FAILED",
        "the title yields no usable page address; use a title with letters or digits",
        [{ path: "title", message: "yields no usable page address" }],
      );
    }
    return parsed.data;
  }

  /**
   * The first candidate in the derived sequence that no retained row holds.
   * Bounded: fifty directions folding to one address is a data problem, not a
   * collision, and a create must never become an unbounded scan.
   */
  private async resolveFreeSlug(
    tx: Parameters<Parameters<DirectionsRepository["transaction"]>[0]>[0],
    base: string,
  ): Promise<string> {
    for (let attempt = 1; attempt <= TAXONOMY_SLUG_ATTEMPT_LIMIT; attempt += 1) {
      const candidate = taxonomySlugCandidate(base, attempt);
      if (!(await this.repo.slugTaken(tx, candidate))) return candidate;
    }
    throw new TaxonomyError(
      "SLUG_CONFLICT",
      "too many directions already derive this page address; give this one a more specific title",
    );
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
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

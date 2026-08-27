import { Inject, Injectable } from "@nestjs/common";
import {
  type CreateDirectionSpecialtyRequest,
  type DirectionSpecialtyAdminDetail,
  type DirectionSpecialtyAdminList,
  type DirectionSpecialtyAdminListQuery,
  type TaxonomyLifecycleTransition,
  taxonomyETag,
} from "@ds/schemas";
import {
  DirectionSpecialtiesRepository,
  type DirectionSpecialtyRow,
} from "./direction-specialties.repository.js";
import {
  type IdempotencyLease,
  IdempotencyService,
} from "./idempotency.service.js";
import { markReplayable, TaxonomyError } from "./taxonomy.errors.js";

// #1483 (ADR-0016 §2.8, 017-design §5) — the direction↔specialty link commands.
// The §5.1 failure ORDER the 012 verticals established is unchanged:
//
//   auth → key shape → payload shape → fingerprint binding → domain transaction
//
// A link is RETAINED. It is created once, retired and restored on the SAME row
// with the SAME id, and never deleted or re-inserted — which is why `create`
// refuses a retired pair by telling the operator to restore it, and why
// `restore` is an UPDATE.
//
// Deliberately WITHOUT the §3.1 lifecycle-impact preview: that gate exists so an
// operator sees which PUBLIC projections a retirement withdraws. This link
// publishes nothing on its own — 017's targeting resolution reads it live per
// request — so a preview here would have an empty affected set every time, and a
// mandatory 428 for an empty preview is ceremony, not a safeguard.

export interface CreateDirectionSpecialtyInput {
  payload: CreateDirectionSpecialtyRequest;
  lease: IdempotencyLease;
}

export interface TransitionInput {
  id: string;
  transition: TaxonomyLifecycleTransition;
  expectedVersion: number;
  lease: IdempotencyLease;
}

/** A command result plus the ETag the client must echo on its next write. */
export interface DirectionSpecialtyCommandResult {
  detail: DirectionSpecialtyAdminDetail;
  etag: string;
}

@Injectable()
export class DirectionSpecialtiesService {
  // Explicit @Inject tokens on every dependency — the root-level
  // `endpoint-authz` gate boots this module graph under `tsx`, whose esbuild
  // transform emits no `design:paramtypes`, so a type-inferred injection
  // resolves to `undefined` there while working under `nest build`.
  constructor(
    @Inject(DirectionSpecialtiesRepository)
    private readonly repo: DirectionSpecialtiesRepository,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  /** `POST /v1/admin/direction-specialties` — link one direction to one specialty. */
  create(
    input: CreateDirectionSpecialtyInput,
  ): Promise<DirectionSpecialtyCommandResult> {
    return this.fenced(input.lease, () => this.createCommand(input));
  }

  /** `POST /v1/admin/direction-specialties/:id/{retire|restore}`. */
  transition(
    input: TransitionInput,
  ): Promise<DirectionSpecialtyCommandResult> {
    return this.fenced(input.lease, () => this.transitionCommand(input));
  }

  /**
   * Tag any DETERMINISTIC refusal with the reserved idempotency record, so the
   * problem filter fenced-stores the outcome and an exact retry replays it
   * (012-design §6 bullet 3).
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
    input: CreateDirectionSpecialtyInput,
  ): Promise<DirectionSpecialtyCommandResult> {
    const { directionId, specialtyMinzdravId } = input.payload;

    const row = await this.repo.transaction(async (tx) => {
      const direction = await this.repo.findDirection(tx, directionId);
      if (!direction) {
        throw new TaxonomyError(
          "RESOURCE_NOT_FOUND",
          "no such direction to link",
        );
      }
      // The Минздрав book is CLOSED (#1479): a specialty is never created here,
      // only referenced, so an unknown id is a 404 and not an implicit insert.
      const specialty = await this.repo.findSpecialty(tx, specialtyMinzdravId);
      if (!specialty) {
        throw new TaxonomyError(
          "RESOURCE_NOT_FOUND",
          "no such Минздрав specialty to link",
        );
      }
      // A withdrawn direction does not take new links. It is not "not found" —
      // it exists and keeps its id forever — so the honest answer names the
      // conflict rather than pretending the endpoint is missing.
      if (direction.status === "retired") {
        throw new TaxonomyError(
          "RELATIONSHIP_CONFLICT",
          "the direction was retired; restore it before linking specialties to it",
        );
      }

      const existing = await this.repo.findPair(
        tx,
        directionId,
        specialtyMinzdravId,
      );
      if (existing) {
        throw new TaxonomyError(
          "RELATIONSHIP_CONFLICT",
          existing.status === "active"
            ? "this specialty is already linked to this direction"
            : "this link exists and is retired; restore it instead of creating a second one",
        );
      }

      const created = await this.repo.insert(tx, {
        directionId,
        specialtyMinzdravId,
      });
      const hydrated = await this.repo.hydrate(tx, created);
      await this.idempotency.complete(tx, input.lease, {
        status: 201,
        body: toDetail(hydrated),
        etag: taxonomyETag(created.version),
        location: `/v1/admin/direction-specialties/${created.id}`,
      });
      return hydrated;
    });

    return { detail: toDetail(row), etag: taxonomyETag(row.relation.version) };
  }

  private async transitionCommand(
    input: TransitionInput,
  ): Promise<DirectionSpecialtyCommandResult> {
    // Optimistic pre-flight OUTSIDE the transaction: a doomed request never
    // opens one. The authoritative checks all repeat inside, under the lock.
    const preflight = await this.repo.detailById(input.id);
    if (!preflight) throw new TaxonomyError("RESOURCE_NOT_FOUND");

    const row = await this.repo.transaction(async (tx) => {
      const locked = await this.repo.lockForTransition(tx, input.id);
      if (!locked) throw new TaxonomyError("RESOURCE_NOT_FOUND");

      if (locked.relation.version !== input.expectedVersion) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the link changed since it was read; reload and retry",
        );
      }
      assertTransitionApplies(locked.relation.status, input.transition);

      const moved = await this.repo.transitionVersioned(
        tx,
        input.id,
        input.expectedVersion,
        input.transition === "retire"
          ? { status: "retired", deletedAt: new Date() }
          : { status: "active", deletedAt: null },
      );
      if (!moved) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the link changed since it was read; reload and retry",
        );
      }
      const hydrated = await this.repo.hydrate(tx, moved);
      await this.idempotency.complete(tx, input.lease, {
        status: 200,
        body: toDetail(hydrated),
        etag: taxonomyETag(moved.version),
      });
      return hydrated;
    });

    return { detail: toDetail(row), etag: taxonomyETag(row.relation.version) };
  }

  /** `GET /v1/admin/direction-specialties/:id` — detail, retired included. */
  async detail(id: string): Promise<DirectionSpecialtyCommandResult> {
    const row = await this.repo.detailById(id);
    if (!row) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    return { detail: toDetail(row), etag: taxonomyETag(row.relation.version) };
  }

  /** `GET /v1/admin/direction-specialties` — either endpoint may scope it. */
  async list(
    query: DirectionSpecialtyAdminListQuery,
  ): Promise<DirectionSpecialtyAdminList> {
    const { rows, total } = await this.repo.list(query);
    return {
      data: rows.map(toDetail),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}

/**
 * A link has exactly two states, so exactly one transition applies at a time.
 * Asking for the one already in effect is not a no-op to swallow: the operator
 * is looking at a stale screen, and 409 `INVALID_TRANSITION` says so.
 */
export function assertTransitionApplies(
  status: "active" | "retired",
  transition: TaxonomyLifecycleTransition,
): void {
  const wanted = transition === "retire" ? "active" : "retired";
  if (status !== wanted) {
    throw new TaxonomyError(
      "INVALID_TRANSITION",
      transition === "retire"
        ? "this relationship is already retired"
        : "this relationship is already active",
    );
  }
}

/**
 * The admin projection of one link — both endpoints' display forms inline, so
 * the link editor renders a table without one follow-up read per row.
 */
function toDetail(row: DirectionSpecialtyRow): DirectionSpecialtyAdminDetail {
  return {
    id: row.relation.id,
    directionId: row.direction.id,
    directionTitle: row.direction.title,
    directionSlug: row.direction.slug,
    specialtyMinzdravId: row.specialty.id,
    specialtyCode: row.specialty.code,
    specialtyName: row.specialty.name,
    status: row.relation.status,
    version: row.relation.version,
    createdAt: row.relation.createdAt.toISOString(),
    updatedAt: row.relation.updatedAt.toISOString(),
  };
}

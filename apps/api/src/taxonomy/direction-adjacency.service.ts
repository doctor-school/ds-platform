import { Inject, Injectable } from "@nestjs/common";
import {
  type CreateDirectionAdjacencyRequest,
  type DirectionAdjacencyAdminDetail,
  type DirectionAdjacencyAdminList,
  type DirectionAdjacencyAdminListQuery,
  type TaxonomyLifecycleTransition,
  type UpdateDirectionAdjacencyRequest,
  taxonomyETag,
} from "@ds/schemas";
import {
  DirectionAdjacencyRepository,
  type DirectionAdjacencyRow,
} from "./direction-adjacency.repository.js";
import { assertTransitionApplies } from "./direction-specialties.service.js";
import {
  type IdempotencyLease,
  IdempotencyService,
} from "./idempotency.service.js";
import { markReplayable, TaxonomyError } from "./taxonomy.errors.js";

// #1483 (ADR-0016 §2.8, 017-design §5) — the direction adjacency commands.
//
// The edge is DIRECTED (see the table doc in `@ds/db`): a mutual relation is TWO
// authored rows, so nothing here silently writes, reads or refuses a reverse
// edge. Authoring B→A while A→B exists is an ordinary create, not a conflict.
//
// Like the direction↔specialty link and unlike the 012 joins, this vertical
// carries no §3.1 lifecycle-impact preview: retiring an edge withdraws no public
// projection, it narrows what 017's targeting resolution reaches on its next
// live read.

export interface CreateDirectionAdjacencyInput {
  payload: CreateDirectionAdjacencyRequest;
  lease: IdempotencyLease;
}

export interface UpdateDirectionAdjacencyInput {
  id: string;
  payload: UpdateDirectionAdjacencyRequest;
  expectedVersion: number;
  lease: IdempotencyLease;
}

export interface AdjacencyTransitionInput {
  id: string;
  transition: TaxonomyLifecycleTransition;
  expectedVersion: number;
  lease: IdempotencyLease;
}

/** A command result plus the ETag the client must echo on its next write. */
export interface DirectionAdjacencyCommandResult {
  detail: DirectionAdjacencyAdminDetail;
  etag: string;
}

@Injectable()
export class DirectionAdjacencyService {
  // Explicit @Inject tokens — the root-level `endpoint-authz` gate boots this
  // graph under `tsx`, which emits no `design:paramtypes`.
  constructor(
    @Inject(DirectionAdjacencyRepository)
    private readonly repo: DirectionAdjacencyRepository,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  /** `POST /v1/admin/direction-adjacency` — author one directed edge. */
  create(
    input: CreateDirectionAdjacencyInput,
  ): Promise<DirectionAdjacencyCommandResult> {
    return this.fenced(input.lease, () => this.createCommand(input));
  }

  /** `PATCH /v1/admin/direction-adjacency/:id` — re-label or re-weight it. */
  update(
    input: UpdateDirectionAdjacencyInput,
  ): Promise<DirectionAdjacencyCommandResult> {
    return this.fenced(input.lease, () => this.updateCommand(input));
  }

  /** `POST /v1/admin/direction-adjacency/:id/{retire|restore}`. */
  transition(
    input: AdjacencyTransitionInput,
  ): Promise<DirectionAdjacencyCommandResult> {
    return this.fenced(input.lease, () => this.transitionCommand(input));
  }

  /** Tag a deterministic refusal with the reserved record, so a retry replays it. */
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
    input: CreateDirectionAdjacencyInput,
  ): Promise<DirectionAdjacencyCommandResult> {
    const { directionId, adjacentDirectionId, kind, weight } = input.payload;

    const row = await this.repo.transaction(async (tx) => {
      const source = await this.repo.findDirection(tx, directionId);
      if (!source) {
        throw new TaxonomyError(
          "RESOURCE_NOT_FOUND",
          "no such direction to author an edge from",
        );
      }
      const target = await this.repo.findDirection(tx, adjacentDirectionId);
      if (!target) {
        throw new TaxonomyError(
          "RESOURCE_NOT_FOUND",
          "no such direction to author an edge to",
        );
      }
      // A withdrawn direction takes no new edges in EITHER position: an edge
      // into a retired direction would be authored and immediately unreachable.
      for (const end of [source, target]) {
        if (end.status === "retired") {
          throw new TaxonomyError(
            "RELATIONSHIP_CONFLICT",
            "the direction was retired; restore it before authoring adjacency for it",
          );
        }
      }

      const existing = await this.repo.findPair(
        tx,
        directionId,
        adjacentDirectionId,
      );
      if (existing) {
        throw new TaxonomyError(
          "RELATIONSHIP_CONFLICT",
          existing.status === "active"
            ? "this adjacency edge already exists; edit its kind or weight instead"
            : "this edge exists and is retired; restore it instead of creating a second one",
        );
      }

      const created = await this.repo.insert(tx, {
        directionId,
        adjacentDirectionId,
        kind,
        weight,
      });
      const hydrated = await this.repo.hydrate(tx, created);
      await this.idempotency.complete(tx, input.lease, {
        status: 201,
        body: toDetail(hydrated),
        etag: taxonomyETag(created.version),
        location: `/v1/admin/direction-adjacency/${created.id}`,
      });
      return hydrated;
    });

    return { detail: toDetail(row), etag: taxonomyETag(row.relation.version) };
  }

  private async updateCommand(
    input: UpdateDirectionAdjacencyInput,
  ): Promise<DirectionAdjacencyCommandResult> {
    const preflight = await this.repo.detailById(input.id);
    if (!preflight) throw new TaxonomyError("RESOURCE_NOT_FOUND");

    const row = await this.repo.transaction(async (tx) => {
      const locked = await this.repo.lockForWrite(tx, input.id);
      if (!locked) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      if (locked.relation.version !== input.expectedVersion) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the edge changed since it was read; reload and retry",
        );
      }
      // A retired edge is not editable: re-labelling something that is out of
      // effect would leave the operator believing they changed what the
      // targeting resolution reads.
      if (locked.relation.status === "retired") {
        throw new TaxonomyError(
          "INVALID_TRANSITION",
          "this edge is retired; restore it before editing it",
        );
      }

      const updated = await this.repo.updateVersioned(
        tx,
        input.id,
        input.expectedVersion,
        input.payload,
      );
      if (!updated) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the edge changed since it was read; reload and retry",
        );
      }
      const hydrated = await this.repo.hydrate(tx, updated);
      await this.idempotency.complete(tx, input.lease, {
        status: 200,
        body: toDetail(hydrated),
        etag: taxonomyETag(updated.version),
      });
      return hydrated;
    });

    return { detail: toDetail(row), etag: taxonomyETag(row.relation.version) };
  }

  private async transitionCommand(
    input: AdjacencyTransitionInput,
  ): Promise<DirectionAdjacencyCommandResult> {
    const preflight = await this.repo.detailById(input.id);
    if (!preflight) throw new TaxonomyError("RESOURCE_NOT_FOUND");

    const row = await this.repo.transaction(async (tx) => {
      const locked = await this.repo.lockForWrite(tx, input.id);
      if (!locked) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      if (locked.relation.version !== input.expectedVersion) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the edge changed since it was read; reload and retry",
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
          "the edge changed since it was read; reload and retry",
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

  /** `GET /v1/admin/direction-adjacency/:id` — detail, retired included. */
  async detail(id: string): Promise<DirectionAdjacencyCommandResult> {
    const row = await this.repo.detailById(id);
    if (!row) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    return { detail: toDetail(row), etag: taxonomyETag(row.relation.version) };
  }

  /** `GET /v1/admin/direction-adjacency` — either END may scope the list. */
  async list(
    query: DirectionAdjacencyAdminListQuery,
  ): Promise<DirectionAdjacencyAdminList> {
    const { rows, total } = await this.repo.list(query);
    return {
      data: rows.map(toDetail),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}

/** The admin projection of one edge — both ends readable, in edge direction. */
function toDetail(row: DirectionAdjacencyRow): DirectionAdjacencyAdminDetail {
  return {
    id: row.relation.id,
    directionId: row.direction.id,
    directionTitle: row.direction.title,
    directionSlug: row.direction.slug,
    adjacentDirectionId: row.adjacent.id,
    adjacentDirectionTitle: row.adjacent.title,
    adjacentDirectionSlug: row.adjacent.slug,
    kind: row.relation.kind,
    weight: row.relation.weight,
    status: row.relation.status,
    version: row.relation.version,
    createdAt: row.relation.createdAt.toISOString(),
    updatedAt: row.relation.updatedAt.toISOString(),
  };
}

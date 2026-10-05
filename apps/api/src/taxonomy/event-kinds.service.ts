import { Inject, Injectable } from "@nestjs/common";
import type { EventKind } from "@ds/db";
import {
  type AdminTaxonomyListQuery,
  type CreateEventKindRequest,
  type EventKindAdminDetail,
  type EventKindAdminList,
  type PublicEventKindList,
  taxonomyETag,
  type UpdateEventKindRequest,
} from "@ds/schemas";
import type {
  LifecycleImpact,
  LifecycleImpactRow,
  TaxonomyLifecycleTransition,
} from "@ds/schemas";
import {
  canonicalFormats,
  type EventKindIncidentEvent,
  EventKindsRepository,
} from "./event-kinds.repository.js";
import {
  type IdempotencyLease,
  IdempotencyService,
} from "./idempotency.service.js";
import {
  type LifecycleImpactBinding,
  LifecycleImpactService,
  type LifecycleImpactTuple,
} from "./lifecycle-impact.service.js";
import {
  markReplayable,
  TaxonomyError,
  withSerializationAbortMapping,
} from "./taxonomy.errors.js";
import { allocateTaxonomySlug, taxonomySlugBase } from "./taxonomy-slug.js";

// 012 EARS-25…28 (#2509) — the event-kind dictionary authoring commands. The
// same §5.1 failure order and lifecycle as the direction vertical (a kind is a
// curated dictionary row, never a constant in code — EARS-27):
//
//   auth (guard) → key shape → fingerprint binding → domain transaction
//   (precondition recheck → write → audit → fenced record completion).
//
// Narrowing `allowedFormats` is REFUSED while any retained event of the kind
// carries a removed format (EARS-25): no event can ever hold a format its kind
// disallows, so there is no mismatch state to flag. The refusal names the
// conflicting events so the editor can re-classify them first.

export interface CreateEventKindInput {
  payload: CreateEventKindRequest;
  lease: IdempotencyLease;
}

export interface UpdateEventKindInput {
  id: string;
  payload: UpdateEventKindRequest;
  expectedVersion: number;
  lease: IdempotencyLease;
}

export interface EventKindCommandResult {
  detail: EventKindAdminDetail;
  etag: string;
}

export interface PublishEventKindInput {
  id: string;
  expectedVersion: number;
  lease: IdempotencyLease;
}

export interface EventKindTransitionInput {
  id: string;
  transition: TaxonomyLifecycleTransition;
  expectedVersion: number;
  impactToken: string;
  lease: IdempotencyLease;
}

const TARGET_KIND = "event-kind" as const;
const STALE = "the event kind changed since it was read; reload and retry";

@Injectable()
export class EventKindsService {
  // Explicit @Inject tokens — see `directions.service.ts` (tsx authz gate).
  constructor(
    @Inject(EventKindsRepository) private readonly repo: EventKindsRepository,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(LifecycleImpactService)
    private readonly impact: LifecycleImpactService,
  ) {}

  create(input: CreateEventKindInput): Promise<EventKindCommandResult> {
    return this.fenced(input.lease, () => this.createCommand(input));
  }

  update(input: UpdateEventKindInput): Promise<EventKindCommandResult> {
    return this.fenced(input.lease, () => this.updateCommand(input));
  }

  publish(input: PublishEventKindInput): Promise<EventKindCommandResult> {
    return this.fenced(input.lease, () => this.publishCommand(input));
  }

  transition(input: EventKindTransitionInput): Promise<EventKindCommandResult> {
    return this.fenced(input.lease, () => this.transitionCommand(input));
  }

  /** §3.1 preview: the public events carrying the kind, plus the signed envelope. */
  async lifecycleImpact(
    id: string,
    transition: TaxonomyLifecycleTransition,
  ): Promise<LifecycleImpact> {
    const target = await this.repo.findById(id);
    if (!target) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    assertTransitionApplies(target.status, transition);

    const incident = await this.repo.discoverIncidentAnywhere(id);
    return {
      transition,
      version: target.version,
      affected: affectedRows(incident),
      impactToken: this.impact.issue({
        transition,
        targetKind: TARGET_KIND,
        targetId: target.id,
        targetVersion: target.version,
        fingerprint: this.impact.fingerprint(fingerprintTuples(incident)),
      }),
    };
  }

  async detail(id: string): Promise<EventKindCommandResult> {
    const row = await this.repo.findById(id);
    if (!row) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    return { detail: toDetail(row), etag: taxonomyETag(row.version) };
  }

  async list(query: AdminTaxonomyListQuery): Promise<EventKindAdminList> {
    const { rows, total } = await this.repo.list(query);
    return {
      data: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        allowedFormats: row.allowedFormats,
        status: row.status,
        version: row.version,
        updatedAt: row.updatedAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** EARS-28 — `GET /v1/public/event-kinds`. */
  async listPublic(): Promise<PublicEventKindList> {
    return { data: await this.repo.listPublic() };
  }

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
    input: CreateEventKindInput,
  ): Promise<EventKindCommandResult> {
    const base = taxonomySlugBase(input.payload.title, "event-kind");
    const row = await this.repo.transaction(async (tx) => {
      await this.repo.lockSlugSequence(tx, base);
      const slug = await allocateTaxonomySlug(base, "event-kind", (candidate) =>
        this.repo.slugTaken(tx, candidate),
      );
      const created = await this.repo.insert(tx, {
        slug,
        title: input.payload.title,
        allowedFormats: canonicalFormats(input.payload.allowedFormats),
      });
      await this.idempotency.complete(tx, input.lease, {
        status: 201,
        body: toDetail(created),
        etag: taxonomyETag(created.version),
        location: `/v1/admin/event-kinds/${created.id}`,
      });
      return created;
    });
    return { detail: toDetail(row), etag: taxonomyETag(row.version) };
  }

  private async updateCommand(
    input: UpdateEventKindInput,
  ): Promise<EventKindCommandResult> {
    const current = await this.repo.findById(input.id);
    if (!current) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    if (current.version !== input.expectedVersion) {
      throw new TaxonomyError("PRECONDITION_FAILED", STALE);
    }

    const row = await this.repo.transaction(async (tx) => {
      const locked = await this.repo.lockById(tx, input.id);
      if (!locked) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      if (locked.version !== input.expectedVersion) {
        throw new TaxonomyError("PRECONDITION_FAILED", STALE);
      }
      if (input.payload.allowedFormats !== undefined) {
        const kept = input.payload.allowedFormats;
        const removed = locked.allowedFormats.filter((f) => !kept.includes(f));
        const conflicts = await this.repo.findEventsWithFormats(
          tx,
          input.id,
          removed,
        );
        if (conflicts.length > 0) throw narrowingConflict(removed, conflicts);
      }
      const updated = await this.repo.updateVersioned(
        tx,
        input.id,
        input.expectedVersion,
        {
          ...(input.payload.title !== undefined
            ? { title: input.payload.title }
            : {}),
          ...(input.payload.allowedFormats !== undefined
            ? { allowedFormats: canonicalFormats(input.payload.allowedFormats) }
            : {}),
        },
      );
      if (!updated) throw new TaxonomyError("PRECONDITION_FAILED", STALE);
      await this.idempotency.complete(tx, input.lease, {
        status: 200,
        body: toDetail(updated),
        etag: taxonomyETag(updated.version),
      });
      return updated;
    });
    return { detail: toDetail(row), etag: taxonomyETag(row.version) };
  }

  /** `draft → published`, `first_published_at` stamped once (LD-3); additive, so no envelope. */
  private async publishCommand(
    input: PublishEventKindInput,
  ): Promise<EventKindCommandResult> {
    const current = await this.repo.findById(input.id);
    if (!current) throw new TaxonomyError("RESOURCE_NOT_FOUND");

    const row = await this.repo.transaction(async (tx) => {
      const locked = await this.repo.lockById(tx, input.id);
      if (!locked) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      if (locked.version !== input.expectedVersion) {
        throw new TaxonomyError("PRECONDITION_FAILED", STALE);
      }
      if (locked.status !== "draft") {
        throw new TaxonomyError(
          "INVALID_TRANSITION",
          locked.status === "published"
            ? "this event kind is already published"
            : "this event kind is retired; restore it before publishing it again",
        );
      }
      const moved = await this.repo.transitionVersioned(
        tx,
        input.id,
        input.expectedVersion,
        {
          status: "published",
          deletedAt: null,
          ...(locked.firstPublishedAt ? {} : { firstPublishedAt: new Date() }),
        },
      );
      if (!moved) throw new TaxonomyError("PRECONDITION_FAILED", STALE);
      await this.idempotency.complete(tx, input.lease, {
        status: 200,
        body: toDetail(moved),
        etag: taxonomyETag(moved.version),
      });
      return moved;
    });
    return { detail: toDetail(row), etag: taxonomyETag(row.version) };
  }

  private async transitionCommand(
    input: EventKindTransitionInput,
  ): Promise<EventKindCommandResult> {
    const preflight = await this.repo.findById(input.id);
    if (!preflight) throw new TaxonomyError("RESOURCE_NOT_FOUND");

    const row = await withSerializationAbortMapping(() =>
      this.repo.serializableTransaction(async (tx) => {
        const locked = await this.repo.lockById(tx, input.id);
        if (!locked) throw new TaxonomyError("RESOURCE_NOT_FOUND");
        if (locked.version !== input.expectedVersion) {
          throw new TaxonomyError("PRECONDITION_FAILED", STALE);
        }
        assertTransitionApplies(locked.status, input.transition);

        // An event that gained or lost the kind, or moved in or out of the
        // public surface, since the preview changes the digest → 412.
        const incident = await this.repo.discoverIncident(tx, input.id);
        const expected: LifecycleImpactBinding = {
          transition: input.transition,
          targetKind: TARGET_KIND,
          targetId: locked.id,
          targetVersion: locked.version,
          fingerprint: this.impact.fingerprint(fingerprintTuples(incident)),
        };
        this.impact.verify(input.impactToken, expected);

        const moved = await this.repo.transitionVersioned(
          tx,
          input.id,
          input.expectedVersion,
          input.transition === "retire"
            ? { status: "retired", deletedAt: new Date() }
            : { status: "draft", deletedAt: null },
        );
        if (!moved) throw new TaxonomyError("PRECONDITION_FAILED", STALE);
        await this.idempotency.complete(tx, input.lease, {
          status: 200,
          body: toDetail(moved),
          etag: taxonomyETag(moved.version),
        });
        return moved;
      }),
    );
    return { detail: toDetail(row), etag: taxonomyETag(row.version) };
  }
}

/**
 * 012 EARS-25 — the refusal of a narrowing that would strand events: a 409
 * `RELATIONSHIP_CONFLICT` (deterministic for the bound input, so it is replayed)
 * with a field error on `allowedFormats` naming every conflicting event.
 */
function narrowingConflict(
  removed: readonly string[],
  conflicts: ReadonlyArray<{ id: string; title: string }>,
): TaxonomyError {
  const named = conflicts.map((e) => `«${e.title}» (${e.id})`).join(", ");
  const message = `events of this kind still use ${removed.join(", ")}: ${named}; change their format or kind first`;
  return new TaxonomyError("RELATIONSHIP_CONFLICT", message, [
    { path: "allowedFormats", message },
  ]);
}

function assertTransitionApplies(
  status: "draft" | "published" | "retired",
  transition: TaxonomyLifecycleTransition,
): void {
  const applies =
    transition === "retire" ? status !== "retired" : status === "retired";
  if (applies) return;
  throw new TaxonomyError(
    "INVALID_TRANSITION",
    transition === "retire"
      ? "this event kind is already retired"
      : "this event kind is not retired, so there is nothing to restore",
  );
}

/** What the operator is shown: the publicly visible events carrying the kind. */
function affectedRows(
  incident: readonly EventKindIncidentEvent[],
): LifecycleImpactRow[] {
  return incident
    .filter((event) => event.publiclyVisible)
    .map((event) => ({
      kind: "event" as const,
      id: event.id,
      title: event.title,
      slug: event.slug,
      status: "published" as const,
    }));
}

/** The fingerprint covers EVERY referencing event, non-public ones included. */
function fingerprintTuples(
  incident: readonly EventKindIncidentEvent[],
): LifecycleImpactTuple[] {
  return incident.map((event) => ({
    kind: "event",
    id: event.id,
    version: event.version,
    state: event.publiclyVisible ? "published" : "hidden",
    eligibility: event.eligibility,
  }));
}

function toDetail(row: EventKind): EventKindAdminDetail {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    allowedFormats: row.allowedFormats,
    status: row.status,
    firstPublishedAt: row.firstPublishedAt?.toISOString() ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

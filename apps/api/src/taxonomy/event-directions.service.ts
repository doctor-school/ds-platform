import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
// #1483 (ADR-0016 §5) renamed the `topics` book to `directions`; #1645 carried
// the rename through this vertical's own nouns, so there is no alias here.
import type { Direction, Event } from "@ds/db";
import {
  type CreateEventDirectionRequest,
  type EventDirectionAdminDetail,
  type EventDirectionAdminList,
  type EventDirectionAdminListQuery,
  type LifecycleImpact,
  type LifecycleImpactRow,
  type PublicCursorQuery,
  type PublicEventSummary,
  type PublicEventSummaryPage,
  type PublicDirectionSummary,
  type PublicDirectionSummaryPage,
  type TaxonomyLifecycleTransition,
  taxonomyETag,
} from "@ds/schemas";
import { PUBLIC_EVENT_STATES } from "./event-projects.repository.js";
import {
  type EventDirectionRow,
  EventDirectionsRepository,
} from "./event-directions.repository.js";
import {
  type IdempotencyLease,
  IdempotencyService,
} from "./idempotency.service.js";
import {
  type LifecycleImpactBinding,
  LifecycleImpactService,
  type LifecycleImpactTuple,
} from "./lifecycle-impact.service.js";
import { EVENT_CURSOR_SHAPE } from "./public-event-cursor.js";
import {
  markReplayable,
  TaxonomyError,
  withSerializationAbortMapping,
} from "./taxonomy.errors.js";

// 012 EARS-11 (#1293) — the event↔direction relationship commands and both §5.2
// traversals. The §5.1 failure ORDER of the sibling verticals is unchanged
// (auth → key shape → fingerprint binding → domain transaction), with the §3.1
// impact gate on the two lifecycle transitions.
//
// Two rules shape this file:
//
// 1. A relationship is RETAINED. It is created once, retired and restored on
//    the SAME row with the SAME id, and never deleted or re-inserted — which is
//    why `create` refuses a retired pair by telling the operator to restore it.
// 2. Tagging an event is LINKING an existing direction. The create command resolves
//    `directionId` against a real `directions` row and refuses a retired one; there is
//    no code path anywhere in this vertical that inserts a direction, and none that
//    reads or writes `events.specialties[]` — directions and specialties are
//    different axes and never synchronize (012-requirements EARS-11).

/**
 * The join kind of this vertical, in the endpoint order §3.1 names. The row
 * kind names the ENTITY on each side of the join, and since #1645 completed the
 * ADR-0016 §5 rename that entity is a `direction` on the route, in the payload
 * and in the impact envelope alike.
 */
const RELATION_KIND = "event↔direction" as const;

export interface CreateEventDirectionInput {
  payload: CreateEventDirectionRequest;
  lease: IdempotencyLease;
}

export interface TransitionInput {
  id: string;
  transition: TaxonomyLifecycleTransition;
  expectedVersion: number;
  impactToken: string;
  lease: IdempotencyLease;
}

/** A command result plus the ETag the client must echo on its next write. */
export interface EventDirectionCommandResult {
  detail: EventDirectionAdminDetail;
  etag: string;
}

@Injectable()
export class EventDirectionsService {
  // Explicit @Inject tokens on every dependency, class ones included — the
  // root-level `endpoint-authz` gate boots this module graph under `tsx`, whose
  // esbuild transform emits no `design:paramtypes`, so a type-inferred
  // injection resolves to `undefined` there while working under `nest build`.
  constructor(
    @Inject(EventDirectionsRepository)
    private readonly repo: EventDirectionsRepository,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(LifecycleImpactService)
    private readonly impact: LifecycleImpactService,
  ) {}

  /** `POST /v1/admin/event-directions` — classify one event under one direction. */
  create(input: CreateEventDirectionInput): Promise<EventDirectionCommandResult> {
    return this.fenced(input.lease, () => this.createCommand(input));
  }

  /** `POST /v1/admin/event-directions/:id/{retire|restore}` — one lifecycle move. */
  transition(input: TransitionInput): Promise<EventDirectionCommandResult> {
    return this.fenced(input.lease, () => this.transitionCommand(input));
  }

  /**
   * Tag any DETERMINISTIC refusal with the reserved idempotency record, so the
   * problem filter fenced-stores the outcome and an exact retry replays it
   * (§6 bullet 3 / EARS-17).
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
    input: CreateEventDirectionInput,
  ): Promise<EventDirectionCommandResult> {
    const { eventId, directionId } = input.payload;

    const row = await this.repo.transaction(async (tx) => {
      const event = await this.repo.findEvent(tx, eventId);
      if (!event) {
        throw new TaxonomyError("RESOURCE_NOT_FOUND", "no such event to tag");
      }
      // EARS-11's «only existing directions» is enforced HERE, not merely by the
      // selector: an unknown id is 404, so an operator (or a script) cannot
      // conjure a direction by referencing one that was never authored.
      const direction = await this.repo.findDirection(tx, directionId);
      if (!direction) {
        throw new TaxonomyError(
          "RESOURCE_NOT_FOUND",
          "no such direction to tag the event with",
        );
      }
      // A withdrawn record does not take new relations. It is not "not found" —
      // it exists and keeps its id forever — so the honest answer names the
      // conflict rather than pretending the endpoint is missing. This is
      // EARS-11's «non-retired directions only» as a SERVER rule: the admin
      // selector already hides retired directions, but hiding a control is not the
      // same as refusing the command.
      if (event.recordStatus === "retired") {
        throw new TaxonomyError(
          "RELATIONSHIP_CONFLICT",
          "the event was retired; restore it before tagging it with directions",
        );
      }
      if (direction.status === "retired") {
        throw new TaxonomyError(
          "RELATIONSHIP_CONFLICT",
          "the direction was retired; restore it before tagging events with it",
        );
      }

      const existing = await this.repo.findPair(tx, eventId, directionId);
      if (existing) {
        throw new TaxonomyError(
          "RELATIONSHIP_CONFLICT",
          existing.status === "active"
            ? "this event is already tagged with this direction"
            : "this relationship exists and is retired; restore it instead of creating a second one",
        );
      }

      const created = await this.repo.insert(tx, { eventId, directionId });
      const hydrated = await this.repo.hydrate(tx, created);
      await this.idempotency.complete(tx, input.lease, {
        status: 201,
        body: toDetail(hydrated),
        etag: taxonomyETag(created.version),
        location: `/v1/admin/event-directions/${created.id}`,
      });
      return hydrated;
    });

    return { detail: toDetail(row), etag: taxonomyETag(row.relation.version) };
  }

  /**
   * `GET /v1/admin/event-directions/:id/lifecycle-impact?transition=` (§3.1) — what
   * the transition would change, plus the signed envelope that authorizes
   * confirming exactly THIS transition against exactly this discovered set.
   */
  async lifecycleImpact(
    id: string,
    transition: TaxonomyLifecycleTransition,
  ): Promise<LifecycleImpact> {
    const target = await this.repo.detailById(id);
    if (!target) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    this.assertTransitionApplies(target, transition);

    const incident = await this.repo.discoverIncidentAnywhere(
      target.event.id,
      target.direction.id,
    );
    const fingerprint = this.impact.fingerprint(fingerprintTuples(incident));

    return {
      transition,
      version: target.relation.version,
      affected: affectedRows(target),
      impactToken: this.impact.issue({
        transition,
        targetKind: RELATION_KIND,
        targetId: target.relation.id,
        targetVersion: target.relation.version,
        fingerprint,
      }),
    };
  }

  private async transitionCommand(
    input: TransitionInput,
  ): Promise<EventDirectionCommandResult> {
    // Optimistic pre-flight OUTSIDE the transaction: a doomed request never
    // opens a SERIALIZABLE one. The authoritative checks all repeat inside.
    const preflight = await this.repo.detailById(input.id);
    if (!preflight) throw new TaxonomyError("RESOURCE_NOT_FOUND");

    // §3.1: a SERIALIZABLE abort is a stale confirmation, not a server fault —
    // mapped to the same 412 as every other stale mode, never auto-retried.
    const row = await withSerializationAbortMapping(() =>
      this.repo.serializableTransaction(async (tx) => {
        const locked = await this.repo.lockForTransition(tx, input.id);
        if (!locked) throw new TaxonomyError("RESOURCE_NOT_FOUND");

        if (locked.relation.version !== input.expectedVersion) {
          throw new TaxonomyError(
            "PRECONDITION_FAILED",
            "the relationship changed since it was read; reload and retry",
          );
        }
        this.assertTransitionApplies(locked, input.transition);

        // Recompute the fingerprint under the lock and verify the envelope
        // against it: a relation inserted, restored or retired since the
        // preview, or an endpoint whose public eligibility moved, changes the
        // digest and makes the confirmation stale (§3.1). Verification happens
        // BEFORE any write, so a stale token leaves zero domain and zero audit
        // mutation.
        const incident = await this.repo.discoverIncident(
          tx,
          locked.event.id,
          locked.direction.id,
        );
        const expected: LifecycleImpactBinding = {
          transition: input.transition,
          targetKind: RELATION_KIND,
          targetId: locked.relation.id,
          targetVersion: locked.relation.version,
          fingerprint: this.impact.fingerprint(fingerprintTuples(incident)),
        };
        this.impact.verify(input.impactToken, expected);

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
            "the relationship changed since it was read; reload and retry",
          );
        }
        const hydrated = await this.repo.hydrate(tx, moved);
        await this.idempotency.complete(tx, input.lease, {
          status: 200,
          body: toDetail(hydrated),
          etag: taxonomyETag(moved.version),
        });
        return hydrated;
      }),
    );

    return { detail: toDetail(row), etag: taxonomyETag(row.relation.version) };
  }

  /** `GET /v1/admin/event-directions/:id` — detail by stable id, retired included. */
  async detail(id: string): Promise<EventDirectionCommandResult> {
    const row = await this.repo.detailById(id);
    if (!row) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    return { detail: toDetail(row), etag: taxonomyETag(row.relation.version) };
  }

  /** `GET /v1/admin/event-directions` — either endpoint may scope the list (§5.1). */
  async list(query: EventDirectionAdminListQuery): Promise<EventDirectionAdminList> {
    const { rows, total } = await this.repo.list(query);
    return {
      data: rows.map(toDetail),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * `GET /v1/public/events/:key/directions` (§5.2) — exactly `PublicDirectionSummary`
   * rows, cursor-paginated. An ineligible source is 404, indistinguishable from
   * an unknown one; an eligible source with no eligible relations is an
   * ordinary empty page, never a 404.
   */
  async publicDirectionsForEvent(
    key: PublicKey,
    query: PublicCursorQuery,
  ): Promise<PublicDirectionSummaryPage> {
    const event = await this.repo.findPublicEvent(key);
    if (!event || !isPublicEvent(event)) {
      throw new TaxonomyError("RESOURCE_NOT_FOUND");
    }
    const after = decodeCursor(query.cursor, DIRECTION_CURSOR_SHAPE);
    // One row beyond the page decides `hasMore` without a second COUNT.
    const rows = await this.repo.listDirectionsForEvent(
      event.id,
      query.limit + 1,
      after,
    );
    const page = rows.slice(0, query.limit);
    const hasMore = rows.length > query.limit;
    const last = page.at(-1);
    return {
      data: page.map(toDirectionSummary),
      pagination: {
        nextCursor:
          hasMore && last
            ? encodeCursor({ title: last.title, id: last.id })
            : null,
        hasMore,
      },
    };
  }

  /** `GET /v1/public/directions/:key/events` (§5.2) — exactly `PublicEventSummary`. */
  async publicEventsForDirection(
    key: PublicKey,
    query: PublicCursorQuery,
  ): Promise<PublicEventSummaryPage> {
    const direction = await this.repo.findPublicDirection(key);
    if (!direction || direction.status !== "published") {
      throw new TaxonomyError("RESOURCE_NOT_FOUND");
    }
    const after = decodeCursor(query.cursor, EVENT_CURSOR_SHAPE);
    const rows = await this.repo.listEventsForDirection(
      direction.id,
      query.limit + 1,
      after,
    );
    const page = rows.slice(0, query.limit);
    const hasMore = rows.length > query.limit;
    const last = page.at(-1);
    return {
      data: page.map(toEventSummary),
      pagination: {
        nextCursor:
          hasMore && last
            ? encodeCursor({
                startsAt: last.startsAtCursor,
                id: last.id,
              })
            : null,
        hasMore,
      },
    };
  }

  /**
   * A relationship has exactly two states, so exactly one transition applies at
   * a time. Asking for the one already in effect is not a no-op to swallow: the
   * operator is looking at a stale screen, and 409 `INVALID_TRANSITION` says so.
   */
  private assertTransitionApplies(
    row: EventDirectionRow,
    transition: TaxonomyLifecycleTransition,
  ): void {
    const wanted = transition === "retire" ? "active" : "retired";
    if (row.relation.status !== wanted) {
      throw new TaxonomyError(
        "INVALID_TRANSITION",
        transition === "retire"
          ? "this relationship is already retired"
          : "this relationship is already active",
      );
    }
  }
}

/** Either half of a §5.2 public key: a canonical UUID id, or a slug. */
export interface PublicKey {
  id?: string;
  slug?: string;
}

/** The publish-visible test a traversal source must pass (§5.2). */
function isPublicEvent(event: Pick<Event, "state" | "recordStatus">): boolean {
  return (
    event.recordStatus === "active" &&
    (PUBLIC_EVENT_STATES as readonly string[]).includes(event.state)
  );
}

function toEventSummary(row: Event): PublicEventSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    school: row.school,
    startsAt: row.startsAt.toISOString(),
    state: row.state,
  };
}

/**
 * The §5.2 `PublicDirectionSummary` — exactly `id, slug, title`. A direction carries no
 * media and no description, so there is nothing here to allow-list away.
 */
function toDirectionSummary(row: Direction): PublicDirectionSummary {
  return { id: row.id, slug: row.slug, title: row.title };
}

/**
 * The §3.1 affected list for a relationship transition. A join move has NO
 * lifecycle effect on either endpoint (§3), so the only row whose public
 * projection changes is the relationship itself — and only when both endpoints
 * are currently publicly eligible: tagging a draft event with a draft direction
 * changes nothing anyone can see, and listing it would tell the operator a
 * consequence that does not exist.
 */
function affectedRows(row: EventDirectionRow): LifecycleImpactRow[] {
  const publiclyEffective =
    isPublicEvent(row.event) && row.direction.status === "published";
  if (!publiclyEffective) return [];
  return [
    {
      kind: RELATION_KIND,
      id: row.relation.id,
      // Never null (§3.1): the operator-readable pairing of both endpoints'
      // display forms, in the order the kind names.
      title: `«${row.event.title} — ${row.direction.title}»`,
      // A relationship has no public URL of its own.
      slug: null,
      status: row.relation.status,
    },
  ];
}

/**
 * The canonical fingerprint input (§3.1): every incident relation AND both of
 * its endpoints' eligibility inputs. The endpoints are tuples of their own, not
 * merely part of the relation's, because an endpoint that becomes (or stops
 * being) public changes what the transition would expose without the relation
 * row moving at all.
 */
function fingerprintTuples(rows: EventDirectionRow[]): LifecycleImpactTuple[] {
  const tuples: LifecycleImpactTuple[] = [];
  const seenEvents = new Set<string>();
  const seenDirections = new Set<string>();
  for (const row of rows) {
    tuples.push({
      kind: "event_directions",
      id: row.relation.id,
      version: row.relation.version,
      state: row.relation.status,
      eligibility: `${row.event.id}>${row.direction.id}`,
    });
    if (!seenEvents.has(row.event.id)) {
      seenEvents.add(row.event.id);
      tuples.push({
        kind: "events",
        id: row.event.id,
        version: null,
        state: row.event.state,
        eligibility: row.event.recordStatus,
      });
    }
    if (!seenDirections.has(row.direction.id)) {
      seenDirections.add(row.direction.id);
      tuples.push({
        kind: "directions",
        id: row.direction.id,
        version: null,
        state: row.direction.status,
        eligibility: row.direction.status,
      });
    }
  }
  return tuples;
}

/**
 * The admin projection of one relationship — both endpoints' display forms
 * inline, so the admin relationship list renders without one follow-up read per
 * row (the same argument §3.1 makes for its `title`).
 */
function toDetail(row: EventDirectionRow): EventDirectionAdminDetail {
  return {
    id: row.relation.id,
    eventId: row.event.id,
    eventTitle: row.event.title,
    eventSlug: row.event.slug,
    directionId: row.direction.id,
    directionTitle: row.direction.title,
    directionSlug: row.direction.slug,
    status: row.relation.status,
    version: row.relation.version,
    createdAt: row.relation.createdAt.toISOString(),
    updatedAt: row.relation.updatedAt.toISOString(),
  };
}

/**
 * The §5.2 cursor is opaque BY CONTRACT: it encodes the stable order tuple the
 * server chose, and a client that decodes and edits it is holding a value the
 * server refuses with 400 `CURSOR_INVALID` rather than one it silently trusts.
 */
function encodeCursor(value: Record<string, string>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/**
 * The title-ordered §5.2 tuple, as a shape rather than a cast.
 *
 * A cursor is caller-supplied bytes on a ZERO-AUTH route, so "decodes to an
 * object" is not enough: the decoded VALUES become SQL operands, and an `id`
 * that is not a UUID reaches a `uuid` column as Postgres `22P02` — a 500 for
 * what EARS-12/EARS-16 contract as 400 `CURSOR_INVALID`. Parsing the tuple here
 * refuses it before any query runs. The event-ordered tuple is the shared
 * `EVENT_CURSOR_SHAPE` (`public-event-cursor.ts`), so both event traversals
 * inherit one grammar.
 */
const DIRECTION_CURSOR_SHAPE = z
  .object({ title: z.string(), id: z.uuid() })
  .strict();

function decodeCursor<T>(
  cursor: string | undefined,
  shape: z.ZodType<T>,
): T | null {
  if (cursor === undefined) return null;
  try {
    return shape.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
  } catch {
    throw new TaxonomyError(
      "CURSOR_INVALID",
      "this cursor was not issued by this API; start from the first page",
    );
  }
}

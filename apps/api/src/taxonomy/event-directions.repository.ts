import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
// #1483 (ADR-0016 §5) renamed the `topics` book to `directions`; #1645
// completed the rename through this vertical, so the join, its column and its
// public route all speak `direction` and no bridge alias survives at the
// import.
import type {
  Direction,
  DrizzleHandle,
  Event,
  EventDirection,
} from "@ds/db";
import { directions, eventDirections, events } from "@ds/db";
import type { EventDirectionAdminListQuery } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";
import { PUBLIC_EVENT_STATES } from "./event-projects.repository.js";

// 012 EARS-11 (#1293) — Drizzle data access for the `event_directions` join. Same
// posture as the sibling `event_projects` repository: every mutating path opens
// its transaction through `withRequestAuditContext`, so feature 010's capture
// trigger attributes the resulting `data.event_directions.*` ledger rows to the
// acting admin without this layer knowing who that is.
//
// A relationship row holds NO editorial content — only its two endpoint ids and
// its own lifecycle — so nothing here is a masked column. Nothing in this file
// reads or writes `events.specialties[]`: directions and specialties are different
// axes (012-requirements EARS-11), and the only way the array could change
// under a direction write is if some query here touched it, so none does.

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** One relationship joined to both endpoints' display forms (§5.1, §3.1). */
export interface EventDirectionRow {
  relation: EventDirection;
  event: Pick<Event, "id" | "slug" | "title" | "state" | "recordStatus">;
  direction: Pick<Direction, "id" | "slug" | "title" | "status">;
}

/** The lifecycle patch a retire/restore applies. */
export interface RelationshipLifecyclePatch {
  status: "active" | "retired";
  deletedAt: Date | null;
}

@Injectable()
export class EventDirectionsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /** Run `fn` in one audit-attributed transaction. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.db, fn);
  }

  /**
   * The §3.1 confirmation boundary: `SERIALIZABLE`, so a phantom relation
   * inserted by a concurrent transaction that overlaps this one cannot slip
   * past the fingerprint recheck. The isolation level is declared as the
   * transaction OPENS — the audit GUCs are ordinary queries, and PostgreSQL
   * refuses to change isolation after the first one.
   */
  serializableTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.db, fn, {
      isolationLevel: "serializable",
    });
  }

  async insert(
    tx: Tx,
    values: { eventId: string; directionId: string },
  ): Promise<EventDirection> {
    const [row] = await tx.insert(eventDirections).values(values).returning();
    if (!row) throw new Error("event_directions insert returned no row");
    return row;
  }

  async findById(id: string): Promise<EventDirection | null> {
    const [row] = await this.db
      .select()
      .from(eventDirections)
      .where(eq(eventDirections.id, id));
    return row ?? null;
  }

  /**
   * Read the relation FOR UPDATE together with both endpoints, in the LD-2/LD-4
   * canonical lock order §3.1 requires of a relation command: `events` before
   * the taxonomy entity before the join row, never target-first. A relation
   * command that locked its own row first and then reached for an endpoint
   * would invert the order an entity command uses and deadlock against it.
   */
  async lockForTransition(tx: Tx, id: string): Promise<EventDirectionRow | null> {
    const [existing] = await tx
      .select()
      .from(eventDirections)
      .where(eq(eventDirections.id, id));
    if (!existing) return null;

    await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, existing.eventId))
      .for("update");
    await tx
      .select({ id: directions.id })
      .from(directions)
      .where(eq(directions.id, existing.directionId))
      .for("update");

    const [locked] = await tx
      .select()
      .from(eventDirections)
      .where(eq(eventDirections.id, id))
      .for("update");
    if (!locked) return null;
    return this.hydrate(tx, locked);
  }

  /** Join one relation row to both endpoints' display forms. */
  async hydrate(tx: Tx | Db, relation: EventDirection): Promise<EventDirectionRow> {
    const [row] = await tx
      .select({
        eventId: events.id,
        eventSlug: events.slug,
        eventTitle: events.title,
        eventState: events.state,
        eventRecordStatus: events.recordStatus,
        directionId: directions.id,
        directionSlug: directions.slug,
        directionTitle: directions.title,
        directionStatus: directions.status,
      })
      .from(events)
      .innerJoin(directions, eq(directions.id, relation.directionId))
      .where(eq(events.id, relation.eventId));
    if (!row) {
      // Both FKs are RESTRICT and nothing in 012 is physically deleted, so an
      // endpoint cannot vanish under a relation. Reaching here means the
      // database no longer satisfies its own constraints.
      throw new Error("event_directions row has an unresolvable endpoint");
    }
    return {
      relation,
      event: {
        id: row.eventId,
        slug: row.eventSlug,
        title: row.eventTitle,
        state: row.eventState,
        recordStatus: row.eventRecordStatus,
      },
      direction: {
        id: row.directionId,
        slug: row.directionSlug,
        title: row.directionTitle,
        status: row.directionStatus,
      },
    };
  }

  async detailById(id: string): Promise<EventDirectionRow | null> {
    const relation = await this.findById(id);
    if (!relation) return null;
    return this.hydrate(this.db, relation);
  }

  /**
   * The logical pair, ACTIVE OR RETIRED (`event_directions_pair_key` spans both).
   * A retired pair is what turns a duplicate create into «restore that relation
   * instead», rather than a second row for one relationship.
   */
  async findPair(
    tx: Tx | Db,
    eventId: string,
    directionId: string,
  ): Promise<EventDirection | null> {
    const [row] = await tx
      .select()
      .from(eventDirections)
      .where(
        and(eq(eventDirections.eventId, eventId), eq(eventDirections.directionId, directionId)),
      );
    return row ?? null;
  }

  async findEvent(tx: Tx | Db, id: string): Promise<Event | null> {
    const [row] = await tx.select().from(events).where(eq(events.id, id));
    return row ?? null;
  }

  async findDirection(tx: Tx | Db, id: string): Promise<Direction | null> {
    const [row] = await tx.select().from(directions).where(eq(directions.id, id));
    return row ?? null;
  }

  /**
   * Move the relation's lifecycle and bump `version` in one statement, guarded
   * by the caller's expected version. Zero rows ⇒ the row moved under the
   * caller. The row's IDENTITY never changes: a restore is this UPDATE, never
   * an INSERT (012-design §2.1).
   */
  async transitionVersioned(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: RelationshipLifecyclePatch,
  ): Promise<EventDirection | null> {
    const [row] = await tx
      .update(eventDirections)
      .set({
        status: patch.status,
        deletedAt: patch.deletedAt,
        version: sql`${eventDirections.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(eq(eventDirections.id, id), eq(eventDirections.version, expectedVersion)),
      )
      .returning();
    return row ?? null;
  }

  /** {@link discoverIncident} against the pool — the preview's optimistic read. */
  discoverIncidentAnywhere(
    eventId: string,
    directionId: string,
  ): Promise<EventDirectionRow[]> {
    return this.discoverIncident(this.db, eventId, directionId);
  }

  /**
   * §3.1 impact discovery — every relation incident to EITHER endpoint of the
   * target, retired ones included, plus both endpoints themselves.
   *
   * Retired relations are in the set deliberately — one restored between
   * preview and confirmation changes the result the operator was shown, even
   * though the target itself did not move.
   */
  async discoverIncident(
    tx: Tx | Db,
    eventId: string,
    directionId: string,
  ): Promise<EventDirectionRow[]> {
    const rows = await tx
      .select({
        relation: eventDirections,
        eventId: events.id,
        eventSlug: events.slug,
        eventTitle: events.title,
        eventState: events.state,
        eventRecordStatus: events.recordStatus,
        directionId: directions.id,
        directionSlug: directions.slug,
        directionTitle: directions.title,
        directionStatus: directions.status,
      })
      .from(eventDirections)
      .innerJoin(events, eq(events.id, eventDirections.eventId))
      .innerJoin(directions, eq(directions.id, eventDirections.directionId))
      .where(
        or(eq(eventDirections.eventId, eventId), eq(eventDirections.directionId, directionId)),
      )
      .orderBy(asc(eventDirections.id));

    return rows.map((row) => ({
      relation: row.relation,
      event: {
        id: row.eventId,
        slug: row.eventSlug,
        title: row.eventTitle,
        state: row.eventState,
        recordStatus: row.eventRecordStatus,
      },
      direction: {
        id: row.directionId,
        slug: row.directionSlug,
        title: row.directionTitle,
        status: row.directionStatus,
      },
    }));
  }

  /** The filtered admin list (§5.1): offset pagination, either endpoint scopes it. */
  async list(
    query: EventDirectionAdminListQuery,
  ): Promise<{ rows: EventDirectionRow[]; total: number }> {
    const filters = [];
    if (query.eventId) filters.push(eq(eventDirections.eventId, query.eventId));
    if (query.directionId) filters.push(eq(eventDirections.directionId, query.directionId));
    if (query.status) {
      filters.push(eq(eventDirections.status, query.status));
    } else if (!query.includeRetired) {
      filters.push(isNull(eventDirections.deletedAt));
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const rows = await this.db
      .select({
        relation: eventDirections,
        eventId: events.id,
        eventSlug: events.slug,
        eventTitle: events.title,
        eventState: events.state,
        eventRecordStatus: events.recordStatus,
        directionId: directions.id,
        directionSlug: directions.slug,
        directionTitle: directions.title,
        directionStatus: directions.status,
      })
      .from(eventDirections)
      .innerJoin(events, eq(events.id, eventDirections.eventId))
      .innerJoin(directions, eq(directions.id, eventDirections.directionId))
      .where(where)
      // Stable total order ending in the relation id — two rows created in the
      // same millisecond must not swap places between pages.
      .orderBy(asc(events.title), asc(directions.title), asc(eventDirections.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await this.db
      .select({ value: count() })
      .from(eventDirections)
      .where(where);

    return {
      rows: rows.map((row) => ({
        relation: row.relation,
        event: {
          id: row.eventId,
          slug: row.eventSlug,
          title: row.eventTitle,
          state: row.eventState,
          recordStatus: row.eventRecordStatus,
        },
        direction: {
          id: row.directionId,
          slug: row.directionSlug,
          title: row.directionTitle,
          status: row.directionStatus,
        },
      })),
      total: Number(totals?.value ?? 0),
    };
  }

  /** Resolve a public event by canonical UUID or slug; eligibility is the caller's. */
  async findPublicEvent(key: {
    id?: string;
    slug?: string;
  }): Promise<Event | null> {
    const where = key.id ? eq(events.id, key.id) : eq(events.slug, key.slug!);
    const [row] = await this.db.select().from(events).where(where);
    return row ?? null;
  }

  /** Resolve a public direction by canonical UUID or slug; eligibility is the caller's. */
  async findPublicDirection(key: {
    id?: string;
    slug?: string;
  }): Promise<Direction | null> {
    const where = key.id ? eq(directions.id, key.id) : eq(directions.slug, key.slug!);
    const [row] = await this.db.select().from(directions).where(where);
    return row ?? null;
  }

  /**
   * §5.2 — the published directions of one event, keyset-paginated on `(title, id)`.
   * Only ACTIVE relations to PUBLISHED directions are traversed: a retired relation
   * and an unpublished endpoint are both invisible here, and neither is
   * distinguishable from «no such relation» by the caller.
   */
  async listDirectionsForEvent(
    eventId: string,
    limit: number,
    after: { title: string; id: string } | null,
  ): Promise<Direction[]> {
    const filters = [
      eq(eventDirections.eventId, eventId),
      eq(eventDirections.status, "active"),
      eq(directions.status, "published"),
    ];
    if (after) {
      filters.push(
        or(
          gt(directions.title, after.title),
          and(eq(directions.title, after.title), gt(directions.id, after.id)),
        )!,
      );
    }
    const rows = await this.db
      .select({ direction: directions })
      .from(eventDirections)
      .innerJoin(directions, eq(directions.id, eventDirections.directionId))
      .where(and(...filters))
      .orderBy(asc(directions.title), asc(directions.id))
      .limit(limit);
    return rows.map((row) => row.direction);
  }

  /**
   * §5.2 — the publish-visible events carrying one direction, keyset-paginated on
   * `(startsAt, id)`: a broadcast list is read chronologically, so the cursor
   * order is the order the reader already sees.
   */
  async listEventsForDirection(
    directionId: string,
    limit: number,
    after: { startsAt: string; id: string } | null,
  ): Promise<Event[]> {
    const filters = [
      eq(eventDirections.directionId, directionId),
      eq(eventDirections.status, "active"),
      eq(events.recordStatus, "active"),
      inArray(events.state, [...PUBLIC_EVENT_STATES]),
    ];
    if (after) {
      const cutoff = new Date(after.startsAt);
      filters.push(
        or(
          gt(events.startsAt, cutoff),
          and(eq(events.startsAt, cutoff), gt(events.id, after.id)),
        )!,
      );
    }
    const rows = await this.db
      .select({ event: events })
      .from(eventDirections)
      .innerJoin(events, eq(events.id, eventDirections.eventId))
      .where(and(...filters))
      .orderBy(asc(events.startsAt), asc(events.id))
      .limit(limit);
    return rows.map((row) => row.event);
  }
}

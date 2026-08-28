import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
// #1483 (ADR-0016 §5) renamed the `topics` book to `directions`. The 012
// EARS-11 join keeps its own nouns — the table is still `event_topics`, the
// column is still `topic_id` and the public route still answers «темы этого
// эфира» — so the rename is bridged at this import instead of being rewritten
// through a vertical whose API surface did not change.
import type {
  Direction as Topic,
  DrizzleHandle,
  Event,
  EventTopic,
} from "@ds/db";
import { directions as topics, eventTopics, events } from "@ds/db";
import type { EventTopicAdminListQuery } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";
import { PUBLIC_EVENT_STATES } from "./event-projects.repository.js";

// 012 EARS-11 (#1293) — Drizzle data access for the `event_topics` join. Same
// posture as the sibling `event_projects` repository: every mutating path opens
// its transaction through `withRequestAuditContext`, so feature 010's capture
// trigger attributes the resulting `data.event_topics.*` ledger rows to the
// acting admin without this layer knowing who that is.
//
// A relationship row holds NO editorial content — only its two endpoint ids and
// its own lifecycle — so nothing here is a masked column. Nothing in this file
// reads or writes `events.specialties[]`: topics and specialties are different
// axes (012-requirements EARS-11), and the only way the array could change
// under a topic write is if some query here touched it, so none does.

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** One relationship joined to both endpoints' display forms (§5.1, §3.1). */
export interface EventTopicRow {
  relation: EventTopic;
  event: Pick<Event, "id" | "slug" | "title" | "state" | "recordStatus">;
  topic: Pick<Topic, "id" | "slug" | "title" | "status">;
}

/** The lifecycle patch a retire/restore applies. */
export interface RelationshipLifecyclePatch {
  status: "active" | "retired";
  deletedAt: Date | null;
}

@Injectable()
export class EventTopicsRepository {
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
    values: { eventId: string; topicId: string },
  ): Promise<EventTopic> {
    const [row] = await tx.insert(eventTopics).values(values).returning();
    if (!row) throw new Error("event_topics insert returned no row");
    return row;
  }

  async findById(id: string): Promise<EventTopic | null> {
    const [row] = await this.db
      .select()
      .from(eventTopics)
      .where(eq(eventTopics.id, id));
    return row ?? null;
  }

  /**
   * Read the relation FOR UPDATE together with both endpoints, in the LD-2/LD-4
   * canonical lock order §3.1 requires of a relation command: `events` before
   * the taxonomy entity before the join row, never target-first. A relation
   * command that locked its own row first and then reached for an endpoint
   * would invert the order an entity command uses and deadlock against it.
   */
  async lockForTransition(tx: Tx, id: string): Promise<EventTopicRow | null> {
    const [existing] = await tx
      .select()
      .from(eventTopics)
      .where(eq(eventTopics.id, id));
    if (!existing) return null;

    await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, existing.eventId))
      .for("update");
    await tx
      .select({ id: topics.id })
      .from(topics)
      .where(eq(topics.id, existing.topicId))
      .for("update");

    const [locked] = await tx
      .select()
      .from(eventTopics)
      .where(eq(eventTopics.id, id))
      .for("update");
    if (!locked) return null;
    return this.hydrate(tx, locked);
  }

  /** Join one relation row to both endpoints' display forms. */
  async hydrate(tx: Tx | Db, relation: EventTopic): Promise<EventTopicRow> {
    const [row] = await tx
      .select({
        eventId: events.id,
        eventSlug: events.slug,
        eventTitle: events.title,
        eventState: events.state,
        eventRecordStatus: events.recordStatus,
        topicId: topics.id,
        topicSlug: topics.slug,
        topicTitle: topics.title,
        topicStatus: topics.status,
      })
      .from(events)
      .innerJoin(topics, eq(topics.id, relation.topicId))
      .where(eq(events.id, relation.eventId));
    if (!row) {
      // Both FKs are RESTRICT and nothing in 012 is physically deleted, so an
      // endpoint cannot vanish under a relation. Reaching here means the
      // database no longer satisfies its own constraints.
      throw new Error("event_topics row has an unresolvable endpoint");
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
      topic: {
        id: row.topicId,
        slug: row.topicSlug,
        title: row.topicTitle,
        status: row.topicStatus,
      },
    };
  }

  async detailById(id: string): Promise<EventTopicRow | null> {
    const relation = await this.findById(id);
    if (!relation) return null;
    return this.hydrate(this.db, relation);
  }

  /**
   * The logical pair, ACTIVE OR RETIRED (`event_topics_pair_key` spans both).
   * A retired pair is what turns a duplicate create into «restore that relation
   * instead», rather than a second row for one relationship.
   */
  async findPair(
    tx: Tx | Db,
    eventId: string,
    topicId: string,
  ): Promise<EventTopic | null> {
    const [row] = await tx
      .select()
      .from(eventTopics)
      .where(
        and(eq(eventTopics.eventId, eventId), eq(eventTopics.topicId, topicId)),
      );
    return row ?? null;
  }

  async findEvent(tx: Tx | Db, id: string): Promise<Event | null> {
    const [row] = await tx.select().from(events).where(eq(events.id, id));
    return row ?? null;
  }

  async findTopic(tx: Tx | Db, id: string): Promise<Topic | null> {
    const [row] = await tx.select().from(topics).where(eq(topics.id, id));
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
  ): Promise<EventTopic | null> {
    const [row] = await tx
      .update(eventTopics)
      .set({
        status: patch.status,
        deletedAt: patch.deletedAt,
        version: sql`${eventTopics.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(eq(eventTopics.id, id), eq(eventTopics.version, expectedVersion)),
      )
      .returning();
    return row ?? null;
  }

  /** {@link discoverIncident} against the pool — the preview's optimistic read. */
  discoverIncidentAnywhere(
    eventId: string,
    topicId: string,
  ): Promise<EventTopicRow[]> {
    return this.discoverIncident(this.db, eventId, topicId);
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
    topicId: string,
  ): Promise<EventTopicRow[]> {
    const rows = await tx
      .select({
        relation: eventTopics,
        eventId: events.id,
        eventSlug: events.slug,
        eventTitle: events.title,
        eventState: events.state,
        eventRecordStatus: events.recordStatus,
        topicId: topics.id,
        topicSlug: topics.slug,
        topicTitle: topics.title,
        topicStatus: topics.status,
      })
      .from(eventTopics)
      .innerJoin(events, eq(events.id, eventTopics.eventId))
      .innerJoin(topics, eq(topics.id, eventTopics.topicId))
      .where(
        or(eq(eventTopics.eventId, eventId), eq(eventTopics.topicId, topicId)),
      )
      .orderBy(asc(eventTopics.id));

    return rows.map((row) => ({
      relation: row.relation,
      event: {
        id: row.eventId,
        slug: row.eventSlug,
        title: row.eventTitle,
        state: row.eventState,
        recordStatus: row.eventRecordStatus,
      },
      topic: {
        id: row.topicId,
        slug: row.topicSlug,
        title: row.topicTitle,
        status: row.topicStatus,
      },
    }));
  }

  /** The filtered admin list (§5.1): offset pagination, either endpoint scopes it. */
  async list(
    query: EventTopicAdminListQuery,
  ): Promise<{ rows: EventTopicRow[]; total: number }> {
    const filters = [];
    if (query.eventId) filters.push(eq(eventTopics.eventId, query.eventId));
    if (query.topicId) filters.push(eq(eventTopics.topicId, query.topicId));
    if (query.status) {
      filters.push(eq(eventTopics.status, query.status));
    } else if (!query.includeRetired) {
      filters.push(isNull(eventTopics.deletedAt));
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const rows = await this.db
      .select({
        relation: eventTopics,
        eventId: events.id,
        eventSlug: events.slug,
        eventTitle: events.title,
        eventState: events.state,
        eventRecordStatus: events.recordStatus,
        topicId: topics.id,
        topicSlug: topics.slug,
        topicTitle: topics.title,
        topicStatus: topics.status,
      })
      .from(eventTopics)
      .innerJoin(events, eq(events.id, eventTopics.eventId))
      .innerJoin(topics, eq(topics.id, eventTopics.topicId))
      .where(where)
      // Stable total order ending in the relation id — two rows created in the
      // same millisecond must not swap places between pages.
      .orderBy(asc(events.title), asc(topics.title), asc(eventTopics.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await this.db
      .select({ value: count() })
      .from(eventTopics)
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
        topic: {
          id: row.topicId,
          slug: row.topicSlug,
          title: row.topicTitle,
          status: row.topicStatus,
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

  /** Resolve a public topic by canonical UUID or slug; eligibility is the caller's. */
  async findPublicTopic(key: {
    id?: string;
    slug?: string;
  }): Promise<Topic | null> {
    const where = key.id ? eq(topics.id, key.id) : eq(topics.slug, key.slug!);
    const [row] = await this.db.select().from(topics).where(where);
    return row ?? null;
  }

  /**
   * §5.2 — the published topics of one event, keyset-paginated on `(title, id)`.
   * Only ACTIVE relations to PUBLISHED topics are traversed: a retired relation
   * and an unpublished endpoint are both invisible here, and neither is
   * distinguishable from «no such relation» by the caller.
   */
  async listTopicsForEvent(
    eventId: string,
    limit: number,
    after: { title: string; id: string } | null,
  ): Promise<Topic[]> {
    const filters = [
      eq(eventTopics.eventId, eventId),
      eq(eventTopics.status, "active"),
      eq(topics.status, "published"),
    ];
    if (after) {
      filters.push(
        or(
          gt(topics.title, after.title),
          and(eq(topics.title, after.title), gt(topics.id, after.id)),
        )!,
      );
    }
    const rows = await this.db
      .select({ topic: topics })
      .from(eventTopics)
      .innerJoin(topics, eq(topics.id, eventTopics.topicId))
      .where(and(...filters))
      .orderBy(asc(topics.title), asc(topics.id))
      .limit(limit);
    return rows.map((row) => row.topic);
  }

  /**
   * §5.2 — the publish-visible events carrying one topic, keyset-paginated on
   * `(startsAt, id)`: a broadcast list is read chronologically, so the cursor
   * order is the order the reader already sees.
   */
  async listEventsForTopic(
    topicId: string,
    limit: number,
    after: { startsAt: string; id: string } | null,
  ): Promise<Event[]> {
    const filters = [
      eq(eventTopics.topicId, topicId),
      eq(eventTopics.status, "active"),
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
      .from(eventTopics)
      .innerJoin(events, eq(events.id, eventTopics.eventId))
      .where(and(...filters))
      .orderBy(asc(events.startsAt), asc(events.id))
      .limit(limit);
    return rows.map((row) => row.event);
  }
}

import { Inject, Injectable } from "@nestjs/common";
import {
  and,
  asc,
  count,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  or,
} from "drizzle-orm";
import type { DrizzleHandle } from "@ds/db";
import {
  directions,
  eventDirections,
  events,
  eventSpeakers,
  registrations,
} from "@ds/db";
import { MONTH_BROADCAST_STATES } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";

type Db = DrizzleHandle["db"];

/**
 * 019 EARS-3 (#1518) — the Doctor projection's data access.
 *
 * This is NOT a second query engine (019-design §1.1, EARS-15): the events
 * themselves, their lifecycle and their public visibility stay owned by 007's
 * aggregate and its `MONTH_BROADCAST_STATES` publish window. What lives here is
 * exactly the Doctor-specific restriction — the managed direction traversal of
 * 017/018 applied to that window over a bounded horizon — and nothing else.
 *
 * The targeting restriction is a SUBQUERY over `event_directions`, never a name
 * comparison of any kind: an event enters the feed only through an active,
 * managed `event → direction` row whose direction is one the caller was handed
 * (@EARS-3 @failure).
 */
export interface DoctorFeedRow {
  id: string;
  slug: string;
  title: string;
  school: string;
  startsAt: Date;
  durationMin: number;
  state: (typeof MONTH_BROADCAST_STATES)[number];
}

export interface DoctorFeedFilters {
  /** `null` = targeting off (`specialty=all`); `[]` = a targeted read with no reachable direction. */
  directionIds: string[] | null;
  /** Half-open horizon `[fromInstant, toInstant)` in UTC. */
  fromInstant: Date;
  toInstant: Date;
  /** Reference ids of the `kind` facet — matched against the managed direction rows. */
  kindIds: string[];
  q?: string | undefined;
}

@Injectable()
export class DoctorEventsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /** The active managed direction rows an event carries, used both to filter and to label. */
  private activeDirectionsOf(directionIds: string[] | null) {
    const restriction = [
      eq(eventDirections.status, "active"),
      isNull(eventDirections.deletedAt),
    ];
    if (directionIds !== null) {
      restriction.push(inArray(eventDirections.directionId, directionIds));
    }
    return this.db
      .select({ id: eventDirections.eventId })
      .from(eventDirections)
      .where(and(...restriction));
  }

  async findFeedRows(filters: DoctorFeedFilters): Promise<DoctorFeedRow[]> {
    // A targeted read that reaches no direction has no events, full stop. Asking
    // Postgres for `direction_id IN ()` would be the same answer through a
    // pointless round trip.
    if (filters.directionIds !== null && filters.directionIds.length === 0) {
      return [];
    }

    const where = [
      eq(events.recordStatus, "active"),
      inArray(events.state, [...MONTH_BROADCAST_STATES]),
      gte(events.startsAt, filters.fromInstant),
      lt(events.startsAt, filters.toInstant),
    ];

    // `specialty=all` drops the targeting subquery entirely rather than passing
    // "every direction id", so an event with no managed direction row is still
    // readable on the untargeted view.
    if (filters.directionIds !== null) {
      where.push(
        inArray(events.id, this.activeDirectionsOf(filters.directionIds)),
      );
    }
    if (filters.kindIds.length > 0) {
      where.push(inArray(events.id, this.activeDirectionsOf(filters.kindIds)));
    }
    if (filters.q !== undefined) {
      const pattern = `%${filters.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      const match = or(
        ilike(events.title, pattern),
        ilike(events.school, pattern),
      );
      if (match) where.push(match);
    }

    const rows = await this.db
      .select({
        id: events.id,
        slug: events.slug,
        title: events.title,
        school: events.school,
        startsAt: events.startsAt,
        durationMin: events.durationMin,
        state: events.state,
      })
      .from(events)
      .where(and(...where))
      .orderBy(asc(events.startsAt), asc(events.id));

    return rows as DoctorFeedRow[];
  }

  /** The lead speaker of each event, by the authored ordering (007 LD-1). */
  async findLeadSpeakers(eventIds: string[]): Promise<Map<string, string>> {
    if (eventIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        eventId: eventSpeakers.eventId,
        name: eventSpeakers.name,
        position: eventSpeakers.position,
      })
      .from(eventSpeakers)
      .where(
        and(
          inArray(eventSpeakers.eventId, eventIds),
          eq(eventSpeakers.recordStatus, "active"),
        ),
      )
      .orderBy(asc(eventSpeakers.eventId), asc(eventSpeakers.position));

    const lead = new Map<string, string>();
    for (const row of rows) {
      if (!lead.has(row.eventId)) lead.set(row.eventId, row.name);
    }
    return lead;
  }

  /**
   * The published direction each event is filed under. Both halves are returned:
   * the ID is the card's `kind` (the facet vocabulary), the title is its display
   * projection — one query, one row, no second vocabulary.
   */
  async findPrimaryDirections(
    eventIds: string[],
  ): Promise<Map<string, { id: string; title: string }>> {
    if (eventIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        eventId: eventDirections.eventId,
        id: directions.id,
        title: directions.title,
      })
      .from(eventDirections)
      .innerJoin(directions, eq(directions.id, eventDirections.directionId))
      .where(
        and(
          inArray(eventDirections.eventId, eventIds),
          eq(eventDirections.status, "active"),
          isNull(eventDirections.deletedAt),
          eq(directions.status, "published"),
          isNull(directions.deletedAt),
        ),
      )
      .orderBy(asc(eventDirections.eventId), asc(directions.title));

    const primary = new Map<string, { id: string; title: string }>();
    for (const row of rows) {
      if (!primary.has(row.eventId)) {
        primary.set(row.eventId, { id: row.id, title: row.title });
      }
    }
    return primary;
  }

  /** Live registrations per event — the «сколько коллег записалось» of EARS-2. */
  async countSignUps(eventIds: string[]): Promise<Map<string, number>> {
    if (eventIds.length === 0) return new Map();
    const rows = await this.db
      .select({ eventId: registrations.eventId, total: count() })
      .from(registrations)
      .where(
        and(
          inArray(registrations.eventId, eventIds),
          eq(registrations.recordStatus, "active"),
        ),
      )
      .groupBy(registrations.eventId);

    return new Map(rows.map((row) => [row.eventId, Number(row.total)]));
  }
}

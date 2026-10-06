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
  sql,
} from "drizzle-orm";
import type { DrizzleHandle } from "@ds/db";
import {
  eventDirections,
  eventExperts,
  eventKinds,
  eventProjects,
  events,
  experts,
  projects,
  registrations,
} from "@ds/db";
import {
  type EventKindRef,
  type EventParticipationFormat,
  MONTH_BROADCAST_STATES,
} from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { isParticipant } from "../auth/staff-role.js";

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
  /** 019 amendment — the event's own attendance mode (`online|offline|hybrid`). */
  participationFormat: EventParticipationFormat;
  /** 012 EARS-28 — the event's kind, read from the dictionary. */
  kind: EventKindRef;
}

/**
 * The card columns both feed reads select — the event plus its kind joined
 * from the 012 dictionary (`events.kind_id` is a NOT NULL FK, so the inner
 * join drops no event).
 */
const FEED_ROW_COLUMNS = {
  id: events.id,
  slug: events.slug,
  title: events.title,
  school: events.school,
  startsAt: events.startsAt,
  durationMin: events.durationMin,
  state: events.state,
  participationFormat: events.participationFormat,
  kind: { id: eventKinds.id, slug: eventKinds.slug, title: eventKinds.title },
};

/**
 * 012 LD-12 / EARS-29 — the doctor storefront reads ONLY `audience = doctors`
 * events; an `experts` event belongs to the Academy and never shows here.
 */
const DOCTOR_AUDIENCE = eq(events.audience, "doctors");

export interface DoctorFeedFilters {
  /** `null` = targeting off (`specialty=all`); `[]` = a targeted read with no reachable direction. */
  directionIds: string[] | null;
  /** Half-open horizon `[fromInstant, toInstant)` in UTC. */
  fromInstant: Date;
  toInstant: Date;
  /** 012 event-kind dictionary SLUGS of the `kind` facet — matched on `events.kind_id`. */
  kindSlugs: string[];
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

  /**
   * The ONE selection predicate of the Doctor feed — eligibility window,
   * targeting, `kind` and `q` — shared by {@link findFeedRows} and
   * {@link findFirstFeedStartAfter}. It is a single builder rather than two
   * copies on purpose: «показать ещё» may only be offered for events the very
   * same predicate would then list, so a divergence here would re-open #1803
   * (a control leading into an empty widening).
   */
  private feedWhere(filters: DoctorFeedFilters) {
    const where = [
      eq(events.recordStatus, "active"),
      DOCTOR_AUDIENCE,
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
    // 019 EARS-17 — the kind facet reads the 012 dictionary: the event's own
    // `kind_id` among the kinds the slugs name (a retired kind is still matched,
    // because the event keeps its reference — EARS-28).
    if (filters.kindSlugs.length > 0) {
      where.push(
        inArray(
          events.kindId,
          this.db
            .select({ id: eventKinds.id })
            .from(eventKinds)
            .where(inArray(eventKinds.slug, filters.kindSlugs)),
        ),
      );
    }
    if (filters.q !== undefined) {
      const pattern = `%${filters.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      const match = or(
        ilike(events.title, pattern),
        ilike(events.school, pattern),
      );
      if (match) where.push(match);
    }

    return where;
  }

  async findFeedRows(filters: DoctorFeedFilters): Promise<DoctorFeedRow[]> {
    // A targeted read that reaches no direction has no events, full stop. Asking
    // Postgres for `direction_id IN ()` would be the same answer through a
    // pointless round trip.
    if (filters.directionIds !== null && filters.directionIds.length === 0) {
      return [];
    }

    const where = this.feedWhere(filters);

    const rows = await this.db
      .select(FEED_ROW_COLUMNS)
      .from(events)
      .innerJoin(eventKinds, eq(eventKinds.id, events.kindId))
      .where(and(...where))
      .orderBy(asc(events.startsAt), asc(events.id));

    return rows as DoctorFeedRow[];
  }

  /**
   * 019 EARS-6 (#1521) — the targeted эфиры that are RUNNING right now.
   *
   * The selection is the feed's own targeting predicate — the same
   * {@link activeDirectionsOf} subquery over the managed `event_directions`
   * rows — with two differences and no others: the lifecycle filter is the
   * single `live` state instead of the whole publish window, and there is NO
   * horizon. The horizon is deliberately dropped rather than widened: an эфир
   * that started before the rendered window is EXCLUDED from the feed (stand
   * finding 2026-09-02), and the live block is precisely the surface where a
   * running эфир must still be reachable.
   *
   * What this method must never become is a second selection path: liveness is
   * 006's `state` column, never `startsAt + durationMin` compared to `now()`
   * here or on any client (019-design §4). Ordered by `startsAt` so a viewer
   * targeted at several concurrent эфиры sees the one that has been running
   * longest — a deterministic tie-break, not a ranking.
   */
  async findLiveRows(directionIds: string[] | null): Promise<DoctorFeedRow[]> {
    // A targeted read that reaches no direction has nothing live, full stop —
    // the same short-circuit `findFeedRows` applies, for the same reason.
    if (directionIds !== null && directionIds.length === 0) return [];

    const where = [
      eq(events.recordStatus, "active"),
      DOCTOR_AUDIENCE,
      eq(events.state, "live"),
    ];
    if (directionIds !== null) {
      where.push(inArray(events.id, this.activeDirectionsOf(directionIds)));
    }

    const rows = await this.db
      .select(FEED_ROW_COLUMNS)
      .from(events)
      .innerJoin(eventKinds, eq(eventKinds.id, events.kindId))
      .where(and(...where))
      .orderBy(asc(events.startsAt), asc(events.id));

    return rows as DoctorFeedRow[];
  }

  /**
   * The earliest start of a feed-eligible event inside `[fromInstant,
   * toInstant)` under the SAME predicate {@link findFeedRows} applies — the
   * question «is there anything at all past the rendered horizon?» (019 LD-2,
   * #1803). `null` means the horizon may not be widened, because widening it
   * would reveal nothing.
   */
  async findFirstFeedStartAfter(
    filters: DoctorFeedFilters,
  ): Promise<Date | null> {
    if (filters.directionIds !== null && filters.directionIds.length === 0) {
      return null;
    }
    if (filters.fromInstant.getTime() >= filters.toInstant.getTime()) {
      return null;
    }

    const rows = await this.db
      .select({ startsAt: events.startsAt })
      .from(events)
      .where(and(...this.feedWhere(filters)))
      .orderBy(asc(events.startsAt))
      .limit(1);

    return rows[0]?.startsAt ?? null;
  }

  /**
   * The lead speaker of each event, by the authored ordering (007 LD-1).
   *
   * 012 EARS-24 (#1607) — the single speaker source is the `event_experts` link
   * table. The eligibility predicate mirrors the canonical projection
   * (`SpeakerProjectionRepository.eligibleExpertLinks`) exactly: an ACTIVE link
   * to a `published`, non-retired, non-removed expert. An expert whose display
   * name cannot be assembled is not a public speaker and is skipped, so a
   * corrupted row degrades to «no lead speaker», never to a half-rendered one.
   * The order is the projection's: `position ASC`, then the stable link id.
   */
  async findLeadSpeakers(eventIds: string[]): Promise<Map<string, string>> {
    if (eventIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        eventId: eventExperts.eventId,
        name: sql<
          string | null
        >`CASE WHEN ${experts.familyName} IS NULL OR ${experts.givenName} IS NULL THEN NULL ELSE concat_ws(' ', ${experts.familyName}, ${experts.givenName}, ${experts.patronymic}) END`,
      })
      .from(eventExperts)
      .innerJoin(experts, eq(experts.id, eventExperts.expertId))
      .where(
        and(
          inArray(eventExperts.eventId, eventIds),
          eq(eventExperts.status, "active"),
          isNull(eventExperts.deletedAt),
          eq(experts.status, "published"),
          isNull(experts.deletedAt),
          isNull(experts.contentRemovedAt),
        ),
      )
      .orderBy(
        asc(eventExperts.eventId),
        asc(eventExperts.position),
        asc(eventExperts.id),
      );

    const lead = new Map<string, string>();
    for (const row of rows) {
      if (row.name === null) continue;
      if (!lead.has(row.eventId)) lead.set(row.eventId, row.name);
    }
    return lead;
  }

  /**
   * 019 EARS-2 — the card's source line: the title of the PUBLISHED project an
   * event is actively linked to (012 `event_projects`). An event with no such
   * project falls back to its authored `school` in the service. Several links
   * resolve by title order, so the answer is deterministic.
   */
  async findProjectTitles(eventIds: string[]): Promise<Map<string, string>> {
    if (eventIds.length === 0) return new Map();
    const rows = await this.db
      .select({ eventId: eventProjects.eventId, title: projects.title })
      .from(eventProjects)
      .innerJoin(projects, eq(projects.id, eventProjects.projectId))
      .where(
        and(
          inArray(eventProjects.eventId, eventIds),
          eq(eventProjects.status, "active"),
          isNull(eventProjects.deletedAt),
          eq(projects.status, "published"),
          isNull(projects.deletedAt),
        ),
      )
      .orderBy(asc(eventProjects.eventId), asc(projects.title));

    const titles = new Map<string, string>();
    for (const row of rows) {
      if (!titles.has(row.eventId)) titles.set(row.eventId, row.title);
    }
    return titles;
  }

  /**
   * Live registrations per event — the «сколько коллег записалось» of EARS-2.
   * Participants only: a staff account's sign-up is not a colleague (#2456).
   */
  async countSignUps(eventIds: string[]): Promise<Map<string, number>> {
    if (eventIds.length === 0) return new Map();
    const rows = await this.db
      .select({ eventId: registrations.eventId, total: count() })
      .from(registrations)
      .where(
        and(
          inArray(registrations.eventId, eventIds),
          eq(registrations.recordStatus, "active"),
          isParticipant(registrations.userId),
        ),
      )
      .groupBy(registrations.eventId);

    return new Map(rows.map((row) => [row.eventId, Number(row.total)]));
  }
}

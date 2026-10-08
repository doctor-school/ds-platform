import { Inject, Injectable } from "@nestjs/common";
import {
  and,
  asc,
  desc,
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
  eventExperts,
  eventKinds,
  eventProjects,
  events,
  experts,
  projects,
} from "@ds/db";
import {
  type EventKindRef,
  type EventParticipationFormat,
  MONTH_BROADCAST_STATES,
} from "@ds/schemas";

/** A lifecycle set a feed read selects — one tense's, or the month grid's. */
export type DoctorFeedStates =
  readonly (typeof MONTH_BROADCAST_STATES)[number][];
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { eventsOnActiveDirections } from "../events/event-direction-restriction.js";
import { countEventSignUps } from "../events/event-sign-ups.js";

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
  /**
   * The lifecycle set the read selects (wave-2 gate row 30): «Будущие» =
   * `UPCOMING_BROADCAST_STATES`, «Прошедшие» = `PAST_BROADCAST_STATES` — the
   * split the Academy listing applies — so a not-yet-ended эфир is never past
   * and an ended one never upcoming, whatever window the read covers.
   */
  states: DoctorFeedStates;
  /** `asc` = soonest first («Будущие», the month grid); `desc` = newest first («Прошедшие», LD-13). */
  order: "asc" | "desc";
  /** `null` = targeting off (`specialty=all`); `[]` = a targeted read with no reachable direction. */
  directionIds: string[] | null;
  /** Half-open horizon `[fromInstant, toInstant)` in UTC; `fromInstant: null` = no older bound (the «Прошедшие» archive). */
  fromInstant: Date | null;
  toInstant: Date;
  /** 012 event-kind dictionary SLUGS of the `kind` facet — matched on `events.kind_id`. */
  kindSlugs: string[];
  q?: string | undefined;
  /** At most this many rows, in `order` — the horizon row cap; omitted = every matching row. */
  limit?: number;
}

@Injectable()
export class DoctorEventsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /** The active managed direction rows an event carries — the one shared targeting subquery. */
  private activeDirectionsOf(directionIds: string[] | null) {
    return eventsOnActiveDirections(this.db, directionIds);
  }

  /**
   * The ONE selection predicate of the Doctor feed — eligibility window,
   * targeting, `kind` and `q` — of {@link findFeedRows}, which serves the
   * rendered window AND the range beyond it («показать ещё» and its
   * remainder). One builder on purpose: «показать ещё» may only be offered for
   * events the very same predicate would then list, so a divergence here would
   * re-open #1803 (a control leading into an empty widening).
   */
  private feedWhere(filters: DoctorFeedFilters) {
    const where = [
      eq(events.recordStatus, "active"),
      DOCTOR_AUDIENCE,
      inArray(events.state, [...filters.states]),
      lt(events.startsAt, filters.toInstant),
    ];
    if (filters.fromInstant !== null) {
      where.push(gte(events.startsAt, filters.fromInstant));
    }

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

    const query = this.db
      .select(FEED_ROW_COLUMNS)
      .from(events)
      .innerJoin(eventKinds, eq(eventKinds.id, events.kindId))
      .where(and(...where))
      .orderBy(
        ...(filters.order === "desc"
          ? [desc(events.startsAt), desc(events.id)]
          : [asc(events.startsAt), asc(events.id)]),
      );
    const rows =
      filters.limit === undefined
        ? await query
        : await query.limit(filters.limit);

    return rows as DoctorFeedRow[];
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
  countSignUps(eventIds: string[]): Promise<Map<string, number>> {
    return countEventSignUps(this.db, eventIds);
  }
}

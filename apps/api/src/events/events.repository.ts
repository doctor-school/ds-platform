import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { DrizzleHandle, Event, NewEvent, NewEventSpeaker } from "@ds/db";
import { auditLedger, eventSpeakers, events, streamConfig } from "@ds/db";
import {
  type ConfigureStreamRequest,
  MONTH_BROADCAST_STATES,
  type StreamConfig,
  UPCOMING_BROADCAST_STATES,
} from "@ds/schemas";
import { and, asc, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { DRIZZLE_DB } from "../database/database.tokens.js";

/**
 * The terminal `audit_ledger` row a named lifecycle transition appends (EARS-4;
 * ADR-0003 §6). `eventType` is the canonical domain event id (e.g.
 * `event.published`); `subjectId` is the acting `platform_admin` Zitadel `sub`
 * (or `null` when unavailable). The `from`/`to` states + the aggregate id land
 * in `metadata` — no PD is ever stored (ADR-0001 §7, ADR-0003 §6).
 */
export interface TransitionAudit {
  eventType: string;
  subjectId: string | null;
  from: Event["state"];
}

/** Canonical UUID v-agnostic shape — used to decide whether `:idOrSlug` can match the uuid `id` column. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = DrizzleHandle["db"];

/** One event aggregate with its ordered speaker rows and (optional) stream config. */
export interface EventWithSpeakers {
  event: Event;
  speakers: { name: string; regalia: string; position: number }[];
  /** The `{ provider, embedRef }` the 006 room consumes (EARS-3); `null` until configured. */
  streamConfig: StreamConfig | null;
}

/**
 * Drizzle data access for the 007 event aggregate (design §3). The write is one
 * transaction — the event row plus its ordered speaker rows land together or not
 * at all, so a partial aggregate is never persisted.
 */
@Injectable()
export class EventsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  async insert(
    event: NewEvent,
    speakers: Omit<NewEventSpeaker, "eventId">[],
  ): Promise<EventWithSpeakers> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(events).values(event).returning();
      if (!row) throw new Error("event insert returned no row");
      if (speakers.length > 0) {
        await tx
          .insert(eventSpeakers)
          .values(speakers.map((s) => ({ ...s, eventId: row.id })));
      }
      return {
        event: row,
        speakers: speakers.map((s) => ({
          name: s.name,
          regalia: s.regalia ?? "",
          position: s.position,
        })),
        // A brand-new event carries no stream config until ConfigureStream runs.
        streamConfig: null,
      };
    });
  }

  /**
   * EARS-2 — edit one event's authored fields and (optionally) replace its
   * ordered speaker list, in a single transaction so a partial edit is never
   * persisted. `patch` carries only the columns to overwrite (an omitted column
   * is untouched); `updated_at` is always bumped. When `speakers` is provided the
   * stored list is replaced wholesale (delete-then-insert, preserving order); when
   * it is `undefined` the speaker rows are left as they are. The caller (the
   * service) has already validated the pre-archive edit window and folded any
   * program-PDF replacement into `patch.programPdfRef`. Returns the updated
   * aggregate, or `null` when the id does not exist.
   */
  async updateEvent(
    id: string,
    patch: Partial<
      Pick<
        NewEvent,
        | "title"
        | "school"
        | "startsAt"
        | "durationMin"
        | "description"
        | "specialties"
        | "partnerRef"
        | "programPdfRef"
      >
    >,
    speakers?: Omit<NewEventSpeaker, "eventId">[],
  ): Promise<EventWithSpeakers | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(events)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(events.id, id))
        .returning();
      if (!row) return null;

      if (speakers) {
        await tx.delete(eventSpeakers).where(eq(eventSpeakers.eventId, id));
        if (speakers.length > 0) {
          await tx
            .insert(eventSpeakers)
            .values(speakers.map((s) => ({ ...s, eventId: id })));
        }
      }

      const speakerRows = await tx
        .select()
        .from(eventSpeakers)
        .where(eq(eventSpeakers.eventId, id))
        .orderBy(asc(eventSpeakers.position));
      const [streamRow] = await tx
        .select()
        .from(streamConfig)
        .where(eq(streamConfig.eventId, id));
      return {
        event: row,
        speakers: speakerRows.map((s) => ({
          name: s.name,
          regalia: s.regalia,
          position: s.position,
        })),
        streamConfig: streamRow
          ? { provider: streamRow.provider, embedRef: streamRow.embedRef }
          : null,
      };
    });
  }

  /**
   * EARS-3 — persist (upsert) the stream config for one event. One config per
   * event: the `event_id` PK makes this an idempotent write, so correcting the
   * config while `published` replaces the single row (no state reversal). The
   * caller (the service) has already validated the state window. Returns `null`
   * when the id does not exist.
   */
  async upsertStreamConfig(
    eventId: string,
    input: ConfigureStreamRequest,
  ): Promise<EventWithSpeakers | null> {
    await this.db
      .insert(streamConfig)
      .values({ eventId, provider: input.provider, embedRef: input.embedRef })
      .onConflictDoUpdate({
        target: streamConfig.eventId,
        set: { provider: input.provider, embedRef: input.embedRef },
      });
    return this.findById(eventId);
  }

  /** Load the stream config for one event, or `null` when unconfigured. */
  private async loadStreamConfig(
    eventId: string,
  ): Promise<StreamConfig | null> {
    const [row] = await this.db
      .select()
      .from(streamConfig)
      .where(eq(streamConfig.eventId, eventId));
    return row ? { provider: row.provider, embedRef: row.embedRef } : null;
  }

  async listAll(): Promise<Event[]> {
    return this.db.select().from(events).orderBy(desc(events.createdAt));
  }

  /**
   * 004 EARS-7 + EARS-6 — the upcoming-broadcasts read. Returns every `published`
   * or `live` event whose `starts_at` is at or after `cutoff` (`now − airWindow`,
   * so a recently-started live event still lists), ordered NEAREST air date first
   * (`starts_at ASC`). The state filter is the {@link UPCOMING_BROADCAST_STATES}
   * SSOT (the same closed set the `UpcomingBroadcastState` card type derives from,
   * so the query and the projection can never disagree about what may appear) —
   * applied in SQL, so a `draft`/`ended`/`archived` event drops from the listing
   * by STATE, never by time (EARS-6: draft/ended/archived never list). Speaker
   * rows for the matched events are read in one batched query (no N+1) and grouped
   * back by event in `position` order. An empty match is a valid empty list
   * (EARS-11).
   */
  async listUpcoming(cutoff: Date): Promise<EventWithSpeakers[]> {
    const rows = await this.db
      .select()
      .from(events)
      .where(
        and(
          inArray(events.state, [...UPCOMING_BROADCAST_STATES]),
          gte(events.startsAt, cutoff),
        ),
      )
      .orderBy(asc(events.startsAt));
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const speakerRows = await this.db
      .select()
      .from(eventSpeakers)
      .where(inArray(eventSpeakers.eventId, ids))
      .orderBy(asc(eventSpeakers.position));

    const byEvent = new Map<string, EventWithSpeakers["speakers"]>();
    for (const s of speakerRows) {
      const list = byEvent.get(s.eventId) ?? [];
      list.push({ name: s.name, regalia: s.regalia, position: s.position });
      byEvent.set(s.eventId, list);
    }
    return rows.map((event) => ({
      event,
      speakers: byEvent.get(event.id) ?? [],
      // The upcoming-listing card (004) does not read the stream config.
      streamConfig: null,
    }));
  }

  /**
   * 004 EARS-15 — the month-range read. Every publish-visible event
   * (`published`/`live`/`ended`, the {@link MONTH_BROADCAST_STATES} SSOT) whose
   * `starts_at` falls in the half-open UTC range `[start, end)` — the МСК month
   * boundaries computed by the caller ({@link import("@ds/schemas").mskMonthRange})
   * — ordered NEAREST air date first (`starts_at ASC`). The month's already-past
   * `ended` events are INCLUDED by design (§3); `draft`/`archived` drop by STATE,
   * never by time. The month-grid entry carries no speaker/commercial field, so
   * this returns the bare event rows (the service projects the thin allow-list).
   * An empty month is a valid empty list.
   */
  async listMonthBroadcasts(start: Date, end: Date): Promise<Event[]> {
    return this.db
      .select()
      .from(events)
      .where(
        and(
          inArray(events.state, [...MONTH_BROADCAST_STATES]),
          gte(events.startsAt, start),
          lt(events.startsAt, end),
        ),
      )
      .orderBy(asc(events.startsAt));
  }

  /**
   * 004 EARS-16 — per-month counts of publish-visible events across one МСК year.
   * Groups by the 1-based МСК calendar month — `starts_at` (a `timestamptz`) is
   * folded to Moscow wall-clock with `AT TIME ZONE 'Europe/Moscow'` (a fixed +3,
   * DST-free), so the grouping month matches the month read's МСК boundaries —
   * counting only `published`/`live`/`ended` events in the half-open year range
   * `[start, end)`. Returns a `month → count` map for the months that HAVE events
   * only; the service fills the zero months so the response is always 12 rows.
   */
  async monthlyCounts(start: Date, end: Date): Promise<Map<number, number>> {
    const monthExpr = sql<number>`extract(month from (${events.startsAt} at time zone 'Europe/Moscow'))::int`;
    const rows = await this.db
      .select({ month: monthExpr, count: sql<number>`count(*)::int` })
      .from(events)
      .where(
        and(
          inArray(events.state, [...MONTH_BROADCAST_STATES]),
          gte(events.startsAt, start),
          lt(events.startsAt, end),
        ),
      )
      .groupBy(monthExpr);
    const byMonth = new Map<number, number>();
    for (const r of rows) byMonth.set(Number(r.month), Number(r.count));
    return byMonth;
  }

  /**
   * Persist a lifecycle state change and bump `updated_at`. The caller (the
   * EARS-7 guard in `EventsService`) has already validated the move against the
   * closed transition set — this is the bare write. Returns the updated
   * aggregate, or `null` when the id does not exist.
   */
  async updateState(
    id: string,
    state: Event["state"],
  ): Promise<EventWithSpeakers | null> {
    const [row] = await this.db
      .update(events)
      .set({ state, updatedAt: new Date() })
      .where(eq(events.id, id))
      .returning();
    if (!row) return null;
    const speakerRows = await this.db
      .select()
      .from(eventSpeakers)
      .where(eq(eventSpeakers.eventId, id))
      .orderBy(asc(eventSpeakers.position));
    return {
      event: row,
      speakers: speakerRows.map((s) => ({
        name: s.name,
        regalia: s.regalia,
        position: s.position,
      })),
      streamConfig: await this.loadStreamConfig(id),
    };
  }

  /**
   * Apply a lifecycle state change AND append exactly one terminal
   * `audit_ledger` row (EARS-4; ADR-0003 §6) in a single transaction — the state
   * write and its audit row land together or not at all, so a transition can
   * never be applied without its ledger row (nor a spurious row written without
   * the state change). The caller (the named transition command in
   * `EventsService`) has already validated the move against the closed
   * transition set (the EARS-7 guard). Returns the updated aggregate, or `null`
   * when the id does not exist.
   */
  async updateStateWithAudit(
    id: string,
    state: Event["state"],
    audit: TransitionAudit,
  ): Promise<EventWithSpeakers | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(events)
        .set({
          state,
          updatedAt: new Date(),
          // Stamp the actual go-live instant exactly on the `published → live`
          // transition (007 `OpenRoom`), and only if it is still unset —
          // `coalesce` makes the write idempotent so a re-run never overwrites the
          // original go-live moment. `live` is unreachable a second time under the
          // closed lifecycle map, so this is set-once in practice; the guard is
          // defence in depth. Every other transition leaves `live_at` untouched.
          ...(state === "live"
            ? { liveAt: sql`coalesce(${events.liveAt}, now())` }
            : {}),
        })
        .where(eq(events.id, id))
        .returning();
      if (!row) return null;
      await tx.insert(auditLedger).values({
        eventId: randomUUID(),
        eventType: audit.eventType,
        subjectId: audit.subjectId,
        // No PD — only the aggregate id + the from/to states (ADR-0003 §6).
        metadata: { aggregateId: id, from: audit.from, to: state },
      });
      const speakerRows = await tx
        .select()
        .from(eventSpeakers)
        .where(eq(eventSpeakers.eventId, id))
        .orderBy(asc(eventSpeakers.position));
      const [streamRow] = await tx
        .select()
        .from(streamConfig)
        .where(eq(streamConfig.eventId, id));
      return {
        event: row,
        speakers: speakerRows.map((s) => ({
          name: s.name,
          regalia: s.regalia,
          position: s.position,
        })),
        streamConfig: streamRow
          ? { provider: streamRow.provider, embedRef: streamRow.embedRef }
          : null,
      };
    });
  }

  async findById(id: string): Promise<EventWithSpeakers | null> {
    const [row] = await this.db.select().from(events).where(eq(events.id, id));
    if (!row) return null;
    return this.withSpeakers(row);
  }

  /**
   * Resolve one event by its stable public slug OR its id (004 EARS-1 — the
   * sponsor-distributed link keys on the slug; id is the fallback). A non-UUID
   * `idOrSlug` matches the slug only — never fed to the uuid `id` column, whose
   * comparison would raise on a malformed value.
   */
  async findByIdOrSlug(idOrSlug: string): Promise<EventWithSpeakers | null> {
    const where = UUID_RE.test(idOrSlug)
      ? or(eq(events.id, idOrSlug), eq(events.slug, idOrSlug))
      : eq(events.slug, idOrSlug);
    const [row] = await this.db.select().from(events).where(where);
    if (!row) return null;
    return this.withSpeakers(row);
  }

  private async withSpeakers(row: Event): Promise<EventWithSpeakers> {
    const speakerRows = await this.db
      .select()
      .from(eventSpeakers)
      .where(eq(eventSpeakers.eventId, row.id))
      .orderBy(asc(eventSpeakers.position));
    return {
      event: row,
      speakers: speakerRows.map((s) => ({
        name: s.name,
        regalia: s.regalia,
        position: s.position,
      })),
      streamConfig: await this.loadStreamConfig(row.id),
    };
  }
}

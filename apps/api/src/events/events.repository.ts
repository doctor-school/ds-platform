import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type {
  DrizzleHandle,
  Event,
  NewEvent,
  NewEventRecording,
  NewEventSpeaker,
} from "@ds/db";
import {
  auditLedger,
  eventRecordings,
  eventSpeakers,
  events,
  streamConfig,
} from "@ds/db";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";
import {
  type ConfigureStreamRequest,
  type EventAdminListQuery,
  MONTH_BROADCAST_STATES,
  PAST_BROADCAST_STATES,
  type StreamConfig,
  UPCOMING_BROADCAST_STATES,
} from "@ds/schemas";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { reconcileEventSpeakers } from "./event-speakers.reconcile.js";

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
/** The drizzle transaction handle a repository write runs inside. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * #1278 (ADR-0003 design §3.6 rule 3) — every default read is the ACTIVE
 * projection. Retired rows stay in the table forever (a removed speaker, a
 * de-configured stream, a retired event are historical facts), so the product
 * read paths have to say so explicitly.
 *
 * The predicate is `record_status = 'active'` and NOT the equivalent
 * `deleted_at IS NULL`, and the partial indexes (`events_active_starts_at_idx`,
 * the speaker slot index, …) are built on the SAME expression on purpose:
 * Postgres proves a partial index applicable from the query's own restriction
 * clauses alone and will not derive one predicate from the other through the
 * `retired ⇔ deleted_at IS NOT NULL` CHECK. Writing the two sides differently
 * silently costs every one of these reads its index.
 */
const activeSpeakersOf = (eventId: string) =>
  and(
    eq(eventSpeakers.eventId, eventId),
    eq(eventSpeakers.recordStatus, "active"),
  );

const activeStreamOf = (eventId: string) =>
  and(
    eq(streamConfig.eventId, eventId),
    eq(streamConfig.recordStatus, "active"),
  );

const ACTIVE_EVENT = eq(events.recordStatus, "active");

/** One event aggregate with its ordered speaker rows and (optional) stream config. */
export interface EventWithSpeakers {
  event: Event;
  speakers: { name: string; regalia: string; position: number }[];
  /** The `{ provider, embedRef }` the 006 room consumes (EARS-3); `null` until configured. */
  streamConfig: StreamConfig | null;
}

export interface EventListingCursor {
  startsAt: Date;
  id: string;
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
    // 010 EARS-3/5 — the capture trigger attributes the resulting data.* rows to
    // the request's actor/source (admin-ui) via the audit-context wrapper.
    return withRequestAuditContext(this.db, async (tx) => {
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
   * 014 EARS-24 (#1741) — persist a whole `legacy` эфир: the event row, its
   * ordered speaker rows AND the one `event_recordings` row it exists to carry,
   * in a SINGLE transaction.
   *
   * The recording is not optional and is not a second call. A two-step
   * create-then-attach shape could leave a `legacy` event with no recording —
   * an эфир that can never be archived (014 EARS-25's precondition), i.e. an
   * untracked seam (AGENTS.md §6, F-22). Doing it here makes «an archival эфир
   * always has something to archive» a database fact.
   *
   * The recording lands at its schema default status `draft`: creation only
   * files the cut, publishing it stays feature 014's own EARS-2 command, and
   * `ArchiveLegacyBroadcast` is gated on that publish having happened.
   */
  async insertLegacyBroadcast(
    event: NewEvent,
    speakers: Omit<NewEventSpeaker, "eventId">[],
    recording: Omit<NewEventRecording, "eventId">,
  ): Promise<EventWithSpeakers> {
    // 010 EARS-3/5 — one audit context for the whole aggregate, so the
    // `data.events.*`, `data.event_speakers.*` and `data.event_recordings.*`
    // ledger rows all name the same acting admin.
    return withRequestAuditContext(this.db, async (tx) => {
      const [row] = await tx.insert(events).values(event).returning();
      if (!row) throw new Error("legacy event insert returned no row");
      if (speakers.length > 0) {
        await tx
          .insert(eventSpeakers)
          .values(speakers.map((s) => ({ ...s, eventId: row.id })));
      }
      await tx.insert(eventRecordings).values({ ...recording, eventId: row.id });
      return {
        event: row,
        speakers: speakers.map((s) => ({
          name: s.name,
          regalia: s.regalia ?? "",
          position: s.position,
        })),
        // A `legacy` эфир never acquires a stream config: `ConfigureStream` is
        // refused for it and `live` is unreachable on its machine.
        streamConfig: null,
      };
    });
  }

  /**
   * EARS-2 — edit one event's authored fields and (optionally) replace its
   * ordered speaker list, in a single transaction so a partial edit is never
   * persisted. `patch` carries only the columns to overwrite (an omitted column
   * is untouched); `updated_at` is always bumped. When `speakers` is provided the
   * stored list is RECONCILED against the authored one (#1278, ADR-0003 design
   * §3.6): a departing speaker is retired, a returning one is restored in place
   * and only a new one is inserted — the list is never deleted and re-created
   * (see {@link reconcileEventSpeakers}). When it is `undefined` the speaker rows
   * are left as they are. The caller (the
   * service) has already validated the pre-hide edit window and folded any
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
        | "recordingExpectedBy"
      >
    >,
    speakers?: Omit<NewEventSpeaker, "eventId">[],
  ): Promise<EventWithSpeakers | null> {
    return withRequestAuditContext(this.db, async (tx) => {
      const [row] = await tx
        .update(events)
        .set({
          ...patch,
          updatedAt: new Date(),
          // #1593 — an authoring edit moves the aggregate the admin detail read
          // projects, so it must invalidate any validator handed out before it.
          // No CAS clause here: `If-Match` is required on the six LIFECYCLE
          // commands only, so this write bumps the counter without asserting one.
          version: sql`${events.version} + 1`,
        })
        // A retired event is not editable — it resolves to `null` (404) exactly
        // as the reads do (#1278 §3.6 rule 3), never a silent write on a removed
        // aggregate.
        .where(and(eq(events.id, id), ACTIVE_EVENT))
        .returning();
      if (!row) return null;

      if (speakers) {
        await reconcileEventSpeakers(tx, id, speakers);
      }

      const speakerRows = await tx
        .select()
        .from(eventSpeakers)
        .where(activeSpeakersOf(id))
        .orderBy(asc(eventSpeakers.position));
      const [streamRow] = await tx
        .select()
        .from(streamConfig)
        .where(activeStreamOf(id));
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
   *
   * #1278 (§3.6 rule 2): because the PK is the event id there is exactly one
   * retained config row per event, so re-configuring a stream that was retired is
   * the explicit RESTORE of that same row — `record_status` back to `active` with
   * `deleted_at` cleared — never a second row and never a delete-then-insert.
   */
  async upsertStreamConfig(
    eventId: string,
    input: ConfigureStreamRequest,
  ): Promise<EventWithSpeakers | null> {
    // 010 EARS-3/5 — attribute the stream_config write to the acting admin.
    await withRequestAuditContext(this.db, async (tx) => {
      await tx
        .insert(streamConfig)
        .values({ eventId, provider: input.provider, embedRef: input.embedRef })
        .onConflictDoUpdate({
          target: streamConfig.eventId,
          set: {
            provider: input.provider,
            embedRef: input.embedRef,
            recordStatus: "active",
            deletedAt: null,
          },
        });
      // #1593 — the stream config is part of the `EventAdminDetail` BODY, so a
      // config change is a change to the resource the `ETag` validates. Bumping
      // the event's counter in the SAME transaction is what stops a validator
      // read before this write from still passing after it; leaving the counter
      // on the `events` row (rather than versioning the child table) keeps ONE
      // validator for the one aggregate the admin surface actually addresses.
      await tx
        .update(events)
        .set({ version: sql`${events.version} + 1`, updatedAt: new Date() })
        .where(and(eq(events.id, eventId), ACTIVE_EVENT));
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
      .where(activeStreamOf(eventId));
    return row ? { provider: row.provider, embedRef: row.embedRef } : null;
  }

  async listAdminPage(
    query: EventAdminListQuery,
  ): Promise<{ rows: Event[]; total: number }> {
    const search = query.q
      ? or(
          ilike(events.title, `%${escapeLike(query.q)}%`),
          ilike(events.slug, `%${escapeLike(query.q)}%`),
        )
      : undefined;
    const where = search ? and(ACTIVE_EVENT, search) : ACTIVE_EVENT;
    const rows = await this.db
      .select()
      .from(events)
      .where(where)
      .orderBy(asc(events.title), asc(events.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const [totals] = await this.db
      .select({ value: count() })
      .from(events)
      .where(where);
    return { rows, total: Number(totals?.value ?? 0) };
  }

  /**
   * 004 EARS-7 + EARS-6 — the upcoming-broadcasts read. Returns every `published`
   * or `live` event whose `starts_at` is at or after `cutoff` (`now − airWindow`,
   * so a recently-started live event still lists), ordered NEAREST air date first
   * (`starts_at ASC`). The state filter is the {@link UPCOMING_BROADCAST_STATES}
   * SSOT (the same closed set the `UpcomingBroadcastState` card type derives from,
   * so the query and the projection can never disagree about what may appear) —
   * applied in SQL, so a `draft`/`ended`/`hidden` event drops from the listing
   * by STATE, never by time (EARS-6: draft/ended/hidden never list). Speaker
   * rows for the matched events are read in one batched query (no N+1) and grouped
   * back by event in `position` order. An empty match is a valid empty list
   * (EARS-11).
   */
  async listUpcoming(
    cutoff: Date,
    limit?: number,
    after: EventListingCursor | null = null,
  ): Promise<EventWithSpeakers[]> {
    const cursor = after
      ? or(
          gt(events.startsAt, after.startsAt),
          and(eq(events.startsAt, after.startsAt), gt(events.id, after.id)),
        )
      : undefined;
    const query = this.db
      .select()
      .from(events)
      .where(
        and(
          ACTIVE_EVENT,
          inArray(events.state, [...UPCOMING_BROADCAST_STATES]),
          gte(events.startsAt, cutoff),
          cursor,
        ),
      )
      .orderBy(asc(events.startsAt), asc(events.id));
    const rows = limit === undefined ? await query : await query.limit(limit);
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const speakerRows = await this.db
      .select()
      .from(eventSpeakers)
      .where(
        and(
          inArray(eventSpeakers.eventId, ids),
          eq(eventSpeakers.recordStatus, "active"),
        ),
      )
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
   * 014 EARS-11 past archive, newest first, with a stable tuple cursor. The
   * state filter is the {@link PAST_BROADCAST_STATES} SSOT, so an `in_archive`
   * legacy эфир (014 EARS-26) sits in «Прошедшие» beside an `ended` platform
   * broadcast — the tab cannot disagree with the count below, which reads the
   * same set.
   */
  async listPast(
    limit: number,
    after: EventListingCursor | null,
  ): Promise<EventWithSpeakers[]> {
    const cursor = after
      ? or(
          lt(events.startsAt, after.startsAt),
          and(eq(events.startsAt, after.startsAt), lt(events.id, after.id)),
        )
      : undefined;
    const rows = await this.db
      .select()
      .from(events)
      .where(
        and(
          ACTIVE_EVENT,
          inArray(events.state, [...PAST_BROADCAST_STATES]),
          cursor,
        ),
      )
      .orderBy(desc(events.startsAt), desc(events.id))
      .limit(limit);
    if (rows.length === 0) return [];

    const speakerRows = await this.db
      .select()
      .from(eventSpeakers)
      .where(
        and(
          inArray(
            eventSpeakers.eventId,
            rows.map((row) => row.id),
          ),
          eq(eventSpeakers.recordStatus, "active"),
        ),
      )
      .orderBy(asc(eventSpeakers.position));
    const byEvent = new Map<string, EventWithSpeakers["speakers"]>();
    for (const speaker of speakerRows) {
      const list = byEvent.get(speaker.eventId) ?? [];
      list.push({
        name: speaker.name,
        regalia: speaker.regalia,
        position: speaker.position,
      });
      byEvent.set(speaker.eventId, list);
    }
    return rows.map((event) => ({
      event,
      speakers: byEvent.get(event.id) ?? [],
      streamConfig: null,
    }));
  }

  /** Counts backing the two controlled `/webinars` tabs. */
  async publicListingCounts(
    cutoff: Date,
  ): Promise<{ upcoming: number; past: number }> {
    const [upcomingRow, pastRow] = await Promise.all([
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(events)
        .where(
          and(
            ACTIVE_EVENT,
            inArray(events.state, [...UPCOMING_BROADCAST_STATES]),
            gte(events.startsAt, cutoff),
          ),
        ),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(events)
        .where(
          and(
            ACTIVE_EVENT,
            inArray(events.state, [...PAST_BROADCAST_STATES]),
          ),
        ),
    ]);
    return {
      upcoming: upcomingRow[0]?.count ?? 0,
      past: pastRow[0]?.count ?? 0,
    };
  }

  /**
   * 004 EARS-15 — the month-range read. Every publish-visible event
   * (`published`/`live`/`ended`, the {@link MONTH_BROADCAST_STATES} SSOT) whose
   * `starts_at` falls in the half-open UTC range `[start, end)` — the МСК month
   * boundaries computed by the caller ({@link import("@ds/schemas").mskMonthRange})
   * — ordered NEAREST air date first (`starts_at ASC`). The month's already-past
   * `ended` events are INCLUDED by design (§3); `draft`/`hidden` drop by STATE,
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
          ACTIVE_EVENT,
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
          ACTIVE_EVENT,
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
   *
   * @param expectedVersion #1593 — when supplied, the write is a COMPARE-AND-SET:
   * the row moves only while its `version` is still the one the caller read. The
   * service pre-checks the same value, but only this clause closes the window
   * between that read and this write, so a concurrent transition cannot be
   * silently overwritten. Zero rows updated is therefore ambiguous here (gone, or
   * moved) — the SERVICE disambiguates 404 from 412, not the repository.
   */
  async updateState(
    id: string,
    state: Event["state"],
    expectedVersion?: number,
  ): Promise<EventWithSpeakers | null> {
    // 010 EARS-3/5 — attribute the bare lifecycle-state write to the acting admin.
    const [row] = await withRequestAuditContext(this.db, (tx) =>
      tx
        .update(events)
        .set({
          state,
          updatedAt: new Date(),
          version: sql`${events.version} + 1`,
        })
        .where(
          and(
            eq(events.id, id),
            ACTIVE_EVENT,
            ...(expectedVersion === undefined
              ? []
              : [eq(events.version, expectedVersion)]),
          ),
        )
        .returning(),
    );
    if (!row) return null;
    const speakerRows = await this.db
      .select()
      .from(eventSpeakers)
      .where(activeSpeakersOf(id))
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
  /**
   * @param fence an optional writer enlisted in the SAME transaction as the
   * state change and the audit row — the 012-design §6 idempotency completion
   * (EARS-17). It runs after the audit insert and throws to abort: a fenced-out
   * owner takes the whole transition down with it, so the record and the domain
   * can never disagree about whether the command applied.
   */
  /**
   * @param expectedVersion #1593 — when supplied, the state write is a
   * COMPARE-AND-SET on the aggregate's `version`, so the transition, its audit
   * row and the fence all fail together if the row moved since the caller read
   * it. Zero rows is ambiguous (gone, or moved) and is disambiguated by the
   * service, not here.
   */
  async updateStateWithAudit(
    id: string,
    state: Event["state"],
    audit: TransitionAudit,
    fence?: (tx: Tx, result: EventWithSpeakers) => Promise<void>,
    expectedVersion?: number,
  ): Promise<EventWithSpeakers | null> {
    // 010 EARS-3/EARS-5 — run the state write inside the audit-context wrapper
    // so the generic capture trigger attributes the resulting
    // `data.events.update` row to the acting admin (`subject_id` = sub) with a
    // concrete `source`, never `db-direct`. The terminal ADR-0003 §6 lifecycle
    // row (below) is a separate, pre-existing obligation written in the SAME tx.
    return withRequestAuditContext(this.db, async (tx) => {
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
          // #1593 — the committed transition invalidates every validator issued
          // before it, inside the very transaction that applies it.
          version: sql`${events.version} + 1`,
        })
        .where(
          and(
            eq(events.id, id),
            ACTIVE_EVENT,
            ...(expectedVersion === undefined
              ? []
              : [eq(events.version, expectedVersion)]),
          ),
        )
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
        .where(activeSpeakersOf(id))
        .orderBy(asc(eventSpeakers.position));
      const [streamRow] = await tx
        .select()
        .from(streamConfig)
        .where(activeStreamOf(id));
      const result: EventWithSpeakers = {
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
      // Fenced idempotency completion, enlisted in this very transaction and run
      // LAST so it stores the committed outcome (012-design §6). It throws when a
      // newer lease owns the record, which rolls the state change and the audit
      // row back with it — a fenced-out owner cannot double-apply the command.
      await fence?.(tx, result);
      return result;
    });
  }

  async findById(id: string): Promise<EventWithSpeakers | null> {
    const [row] = await this.db
      .select()
      .from(events)
      .where(and(eq(events.id, id), ACTIVE_EVENT));
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
    const [row] = await this.db
      .select()
      .from(events)
      .where(and(where, ACTIVE_EVENT));
    if (!row) return null;
    return this.withSpeakers(row);
  }

  private async withSpeakers(row: Event): Promise<EventWithSpeakers> {
    const speakerRows = await this.db
      .select()
      .from(eventSpeakers)
      .where(activeSpeakersOf(row.id))
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

/** Treat SQL wildcard characters in an operator query as literal text. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { DrizzleHandle, Event, EventRecording } from "@ds/db";
import { eventRecordings, events } from "@ds/db";
import {
  CANONICAL_UUID_REGEX,
  type RecordingKind,
  type RecordingStatus,
  type StreamProvider,
} from "@ds/schemas";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";

// 014 EARS-1 / EARS-2 (#1339) — Drizzle access for the `event_recordings`
// aggregate. Every mutating path runs inside `withRequestAuditContext`, so
// feature 010's capture trigger attributes the resulting `data.event_recordings.*`
// ledger rows to the acting admin without this layer knowing who that is.
//
// No method in this file can delete a row. That is not an omission: 014-design §3
// says retire is the terminal action and it is reversible, so «gone» is always a
// retained row with `deleted_at` set.

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface RecordingInsert {
  eventId: string;
  kind: RecordingKind;
  provider: StreamProvider;
  embedRef: string;
  posterRef: string | null;
  durationSec: number | null;
}

/**
 * One row of the EARS-3 projection read: an event, plus ONE of its published
 * non-retired recordings, or the event alone with `kind === null` when it has
 * none (the LEFT JOIN's unmatched side — that is the `preparing` case).
 */
export interface ProjectionRow {
  eventId: string;
  recordingExpectedBy: string | null;
  kind: RecordingKind | null;
  posterRef: string | null;
}

/**
 * One published, non-retired cut WITH its source — the row set behind the
 * authenticated EARS-5 read, and the only place this repository selects
 * `provider` / `embed_ref` for a non-admin caller.
 */
export interface PlayableRow {
  kind: RecordingKind;
  provider: StreamProvider;
  embedRef: string;
  posterRef: string | null;
  durationSec: number | null;
}

/** The field patch a PATCH applies. `undefined` means unchanged. */
export interface RecordingPatch {
  provider?: StreamProvider;
  embedRef?: string;
  posterRef?: string | null;
  durationSec?: number | null;
  status?: RecordingStatus;
  firstPublishedAt?: Date;
  deletedAt?: Date | null;
}

@Injectable()
export class RecordingsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /** Run `fn` in one audit-attributed transaction. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.db, fn);
  }

  async findEvent(id: string): Promise<Event | null> {
    const [row] = await this.db.select().from(events).where(eq(events.id, id));
    return row ?? null;
  }

  /**
   * The event's lifecycle state read under the ROW lock, inside the caller's
   * transaction. Publication is gated on `state = ended` (§3) and the state is
   * moved by 007's own transitions, so the check has to be re-read under a lock
   * — an optimistic read alone would let a concurrent `CloseRoom` or
   * `ArchiveEvent` decide the outcome after the fact.
   */
  async lockEvent(tx: Tx, id: string): Promise<Event | null> {
    const [row] = await tx
      .select()
      .from(events)
      .where(eq(events.id, id))
      .for("update");
    return row ?? null;
  }

  async findById(id: string): Promise<EventRecording | null> {
    const [row] = await this.db
      .select()
      .from(eventRecordings)
      .where(eq(eventRecordings.id, id));
    return row ?? null;
  }

  /** Read the row FOR UPDATE inside a transaction — the concurrency boundary. */
  async lockById(tx: Tx, id: string): Promise<EventRecording | null> {
    const [row] = await tx
      .select()
      .from(eventRecordings)
      .where(eq(eventRecordings.id, id))
      .for("update");
    return row ?? null;
  }

  /**
   * The non-retired row holding `(eventId, kind)`, if any — the row a 409
   * `RECORDING_KIND_OCCUPIED` must NAME. Reads off `deleted_at IS NULL`, the
   * same predicate the partial unique index uses, so the pre-flight refusal and
   * the final race guard can never disagree about what «occupied» means.
   */
  async activeOfKind(
    tx: Tx | Db,
    eventId: string,
    kind: RecordingKind,
  ): Promise<EventRecording | null> {
    const [row] = await tx
      .select()
      .from(eventRecordings)
      .where(
        and(
          eq(eventRecordings.eventId, eventId),
          eq(eventRecordings.kind, kind),
          isNull(eventRecordings.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** {@link activeOfKind} against the pool — the optimistic pre-flight read. */
  activeOfKindAnywhere(
    eventId: string,
    kind: RecordingKind,
  ): Promise<EventRecording | null> {
    return this.activeOfKind(this.db, eventId, kind);
  }

  async insert(tx: Tx, values: RecordingInsert): Promise<EventRecording> {
    const [row] = await tx
      .insert(eventRecordings)
      .values(values)
      .returning();
    if (!row) throw new Error("recording insert returned no row");
    return row;
  }

  /**
   * Apply a patch and bump `version` in one statement, guarded by the caller's
   * expected version. Zero rows ⇒ the row moved under the caller (412).
   */
  async updateVersioned(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: RecordingPatch,
  ): Promise<EventRecording | null> {
    const [row] = await tx
      .update(eventRecordings)
      .set({
        ...patch,
        version: sql`${eventRecordings.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(eventRecordings.id, id),
          eq(eventRecordings.version, expectedVersion),
        ),
      )
      .returning();
    return row ?? null;
  }

  /**
   * 014 EARS-3 (#1340) — the ONE statement behind the derived projection
   * (014-design §4). For every requested event it returns the event's own
   * `recording_expected_by` plus, via a LEFT JOIN, its published non-retired
   * recordings — at most two rows per event, one per kind.
   *
   * A LEFT JOIN rather than two queries or a per-event call: the listing badge
   * (#1347) and «Мои события» (#1346) resolve a whole page of cards, and a
   * per-card read is the N+1 shape LD-8 forbids. The join predicate is
   * `status = 'published' AND deleted_at IS NULL`, character-for-character the
   * predicate of the `event_recordings_event_published_idx` partial index, so
   * the read hits that index instead of filtering the aggregate.
   *
   * The `deleted_at` of the EVENT is not filtered here: publicly-readable is a
   * caller-side concern (012's default-deny), and this method must stay usable
   * by the admin panel and by an authenticated read alike.
   *
   * @param eventIds EVENT UUIDs, never slugs. Several consumer routes are keyed on
   * `:idOrSlug` (014-design §4); a slug reaching `inArray(events.id, …)` goes to
   * Postgres raw and comes back as `22P02 invalid input syntax for type uuid` — a
   * 500, not a 404. Slug-to-id resolution belongs in the consumer, before this call.
   */
  async projectionRowsByEvents(
    eventIds: readonly string[],
  ): Promise<ProjectionRow[]> {
    if (eventIds.length === 0) return [];
    return this.db
      .select({
        eventId: events.id,
        recordingExpectedBy: events.recordingExpectedBy,
        kind: eventRecordings.kind,
        posterRef: eventRecordings.posterRef,
      })
      .from(events)
      .leftJoin(
        eventRecordings,
        and(
          eq(eventRecordings.eventId, events.id),
          eq(eventRecordings.status, "published"),
          isNull(eventRecordings.deletedAt),
        ),
      )
      .where(inArray(events.id, [...eventIds]));
  }

  /**
   * 014 EARS-5 (#1343) — resolve `:idOrSlug` to the event the playback read is
   * about. The 004/005/006 rule verbatim: a value that is not a canonical UUID
   * is matched against the SLUG COLUMN ONLY, because feeding it to the uuid `id`
   * column reaches Postgres as `22P02 invalid input syntax for type uuid` and
   * surfaces as a 500 where the caller deserves a 404.
   *
   * RETIRED EVENTS ARE NOT RESOLVED. `record_status = 'active'` is the same
   * predicate 004's public resolution applies (`events.repository.ts` →
   * `ACTIVE_EVENT`) and the sibling source-bearing 006 room read applies
   * (`room.repository.ts`). Without it a soft-deleted event would 404 publicly
   * and still answer this route 200 with `provider` + `embed_ref` to any
   * signed-in account — authenticating would turn the route into an oracle on
   * a record the platform says does not exist.
   */
  async findEventByIdOrSlug(idOrSlug: string): Promise<Event | null> {
    const key = CANONICAL_UUID_REGEX.test(idOrSlug)
      ? or(eq(events.id, idOrSlug), eq(events.slug, idOrSlug))
      : eq(events.slug, idOrSlug);
    const where = and(key, eq(events.recordStatus, "active"));
    const [row] = await this.db.select().from(events).where(where).limit(1);
    return row ?? null;
  }

  /**
   * 014 EARS-5 (#1343) — the published, non-retired rows of ONE event WITH their
   * sources, for the authenticated playback read (014-design §5).
   *
   * Deliberately separate from {@link projectionRowsByEvents}: that read is
   * source-FREE by construction and feeds every public surface, and widening it
   * to carry `provider`/`embed_ref` "for the one caller that needs them" is
   * exactly how a source ends up in a guest's HTML. Two reads, two column sets,
   * one of which can never leak. The row PREDICATE is identical, so which cuts
   * exist cannot disagree between the gate and the badge.
   */
  playableRowsByEvent(eventId: string): Promise<PlayableRow[]> {
    return this.db
      .select({
        kind: eventRecordings.kind,
        provider: eventRecordings.provider,
        embedRef: eventRecordings.embedRef,
        posterRef: eventRecordings.posterRef,
        durationSec: eventRecordings.durationSec,
      })
      .from(eventRecordings)
      .where(
        and(
          eq(eventRecordings.eventId, eventId),
          eq(eventRecordings.status, "published"),
          isNull(eventRecordings.deletedAt),
        ),
      );
  }

  /**
   * Every retained row of one event, RETIRED ONES INCLUDED (§3: a retired row
   * stays addressable). Ordered by kind then creation so the panel's two rows
   * keep a stable place and a superseded retired row lists under its successor.
   */
  listByEvent(eventId: string): Promise<EventRecording[]> {
    return this.db
      .select()
      .from(eventRecordings)
      .where(eq(eventRecordings.eventId, eventId))
      .orderBy(
        asc(eventRecordings.kind),
        asc(eventRecordings.createdAt),
        asc(eventRecordings.id),
      );
  }
}

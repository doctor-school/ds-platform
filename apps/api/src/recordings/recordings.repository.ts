import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { DrizzleHandle, Event, EventRecording } from "@ds/db";
import { eventRecordings, events } from "@ds/db";
import type {
  RecordingKind,
  RecordingStatus,
  StreamProvider,
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

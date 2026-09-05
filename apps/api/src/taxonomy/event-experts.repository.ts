import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { DrizzleHandle, EventExpert } from "@ds/db";
import { eventExperts, events, experts } from "@ds/db";
import type { AdminEventExpertListQuery } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";
import { withSlotConflictMapping } from "./taxonomy.errors.js";

// 012 EARS-7 (#1289) — Drizzle data access for the `event_experts` join, shaped
// like the entity repositories: every mutating path runs through
// `withRequestAuditContext`, so feature 010's capture trigger attributes the
// resulting `data.event_experts.*` ledger rows to the acting admin.
//
// The lock helpers below are the physical half of the 012-design §2.3 / §4 write
// protocol. Their ORDER is the contract, not an implementation detail:
//
//   affected experts (ascending stable id) → parent event → child rows
//
// Every 012 expert-link write and every expert lifecycle transaction takes the
// same order, which is what makes "relation commits first, lifecycle
// revalidates" and "lifecycle commits first, relation revalidates" the only two
// possible interleavings instead of a deadlock.

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** The transaction handle every command in this vertical passes around. */
export type TaxonomyTx = Tx;

/** The lifecycle facts a link write needs about its expert endpoint. */
export interface ExpertLifecycle {
  id: string;
  status: "draft" | "published" | "retired";
  deletedAt: Date | null;
  contentRemovedAt: Date | null;
}

export interface EventExpertInsert {
  eventId: string;
  expertId: string;
  role: string;
  position: number;
}

/** The field patch a PATCH applies. `undefined` means unchanged. */
export interface EventExpertPatch {
  role?: string;
  position?: number;
  status?: "active" | "retired";
  deletedAt?: Date | null;
}

@Injectable()
export class EventExpertsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /** Run `fn` in one audit-attributed transaction. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.db, fn);
  }

  /**
   * Step 1 of the §2.3 lock order: lock every affected expert row, ASCENDING by
   * stable id. `ids` is de-duplicated and sorted here rather than by the caller
   * so no call site can accidentally establish a second order — a PATCH that
   * re-points nothing still passes exactly one id, and the sort is a no-op.
   *
   * The predicate uses `inArray` rather than a hand-written `= ANY(...)`
   * fragment: inside a `sql` template drizzle binds a JS array as one scalar
   * parameter per element, so Postgres receives a bare uuid where it expects an
   * array literal (22P02). `inArray` expands the list itself; `ORDER BY id ASC`
   * still sorts under the LockRows node, so the ascending lock order holds.
   */
  async lockExperts(tx: Tx, ids: string[]): Promise<ExpertLifecycle[]> {
    const ordered = [...new Set(ids)].sort();
    if (ordered.length === 0) return [];
    const rows = await tx
      .select({
        id: experts.id,
        status: experts.status,
        deletedAt: experts.deletedAt,
        contentRemovedAt: experts.contentRemovedAt,
      })
      .from(experts)
      .where(inArray(experts.id, ordered))
      .orderBy(asc(experts.id))
      .for("update");
    return rows;
  }

  /**
   * Step 2 of the §2.3 lock order: lock the parent event. Taken AFTER the expert
   * locks so a 007 write, which begins at the event boundary, and a 012 link
   * write cannot hold each other's next lock.
   */
  async lockEvent(tx: Tx, eventId: string): Promise<{ id: string } | null> {
    const [row] = await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, eventId))
      .for("update");
    return row ?? null;
  }

  /** Every expert link of the event — re-read under the event lock. */
  async linksOfEvent(tx: Tx, eventId: string): Promise<EventExpert[]> {
    return tx
      .select()
      .from(eventExperts)
      .where(eq(eventExperts.eventId, eventId));
  }

  /**
   * The lifecycle of every expert referenced by `ids`, WITHOUT locking — used to
   * classify the other links of the same event once their rows are already
   * pinned by the event lock. Those experts are not being mutated, so locking
   * them would widen the lock set past §2.3's "affected experts".
   */
  async expertLifecycles(tx: Tx, ids: string[]): Promise<ExpertLifecycle[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    return tx
      .select({
        id: experts.id,
        status: experts.status,
        deletedAt: experts.deletedAt,
        contentRemovedAt: experts.contentRemovedAt,
      })
      .from(experts)
      .where(inArray(experts.id, unique));
  }

  async insert(tx: Tx, values: EventExpertInsert): Promise<EventExpert> {
    return withSlotConflictMapping(async () => {
      const [row] = await tx.insert(eventExperts).values(values).returning();
      if (!row) throw new Error("event_expert insert returned no row");
      return row;
    });
  }

  async findById(id: string): Promise<EventExpert | null> {
    const [row] = await this.db
      .select()
      .from(eventExperts)
      .where(eq(eventExperts.id, id));
    return row ?? null;
  }

  /** Read the link FOR UPDATE — taken after the expert and event locks. */
  async lockById(tx: Tx, id: string): Promise<EventExpert | null> {
    const [row] = await tx
      .select()
      .from(eventExperts)
      .where(eq(eventExperts.id, id))
      .for("update");
    return row ?? null;
  }

  /**
   * Whether the `(eventId, expertId)` pair is already held by a RETAINED row
   * other than `exceptId` — a retired link included (012-design §2.1): a retired
   * relation is restored, never reinserted.
   */
  async pairTaken(
    tx: Tx,
    eventId: string,
    expertId: string,
    exceptId?: string,
  ): Promise<boolean> {
    const where = exceptId
      ? and(
          eq(eventExperts.eventId, eventId),
          eq(eventExperts.expertId, expertId),
          ne(eventExperts.id, exceptId),
        )
      : and(
          eq(eventExperts.eventId, eventId),
          eq(eventExperts.expertId, expertId),
        );
    const [row] = await tx
      .select({ id: eventExperts.id })
      .from(eventExperts)
      .where(where)
      .limit(1);
    return Boolean(row);
  }

  /**
   * Apply a patch and bump `version` in one statement, guarded by the caller's
   * expected version. Zero rows ⇒ the row moved under the caller (412).
   */
  async updateVersioned(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: EventExpertPatch,
  ): Promise<EventExpert | null> {
    return withSlotConflictMapping(async () => {
      const [row] = await tx
        .update(eventExperts)
        .set({
          ...patch,
          version: sql`${eventExperts.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(eventExperts.id, id),
            eq(eventExperts.version, expectedVersion),
          ),
        )
        .returning();
      return row ?? null;
    });
  }

  /**
   * The join admin list (012-design §5.1): offset pagination, endpoint filters,
   * explicit status, retired rows excluded unless asked for. Ordered by the
   * event, then the slot, then the stable id — two links written in the same
   * millisecond must not swap places between pages.
   */
  async list(
    query: AdminEventExpertListQuery,
  ): Promise<{ rows: EventExpert[]; total: number }> {
    const filters = [];
    if (query.eventId) filters.push(eq(eventExperts.eventId, query.eventId));
    if (query.expertId) filters.push(eq(eventExperts.expertId, query.expertId));
    if (query.status) {
      filters.push(eq(eventExperts.status, query.status));
    } else if (!query.includeRetired) {
      filters.push(isNull(eventExperts.deletedAt));
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const rows = await this.db
      .select()
      .from(eventExperts)
      .where(where)
      .orderBy(
        asc(eventExperts.eventId),
        asc(eventExperts.position),
        asc(eventExperts.id),
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await this.db
      .select({ value: count() })
      .from(eventExperts)
      .where(where);
    return { rows, total: Number(totals?.value ?? 0) };
  }
}

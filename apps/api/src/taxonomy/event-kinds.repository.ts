import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { DrizzleHandle, EventKind } from "@ds/db";
import { eventKinds, events } from "@ds/db";
import type { AdminTaxonomyListQuery, EventParticipationFormat } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";

// 012 EARS-25…28 (#2509) — Drizzle data access for the `event_kinds` dictionary,
// shaped exactly like `DirectionsRepository`: every mutating path runs through
// `withRequestAuditContext`, so feature 010's capture trigger attributes the
// `data.event_kinds.*` ledger rows to the acting admin. A kind is referenced by
// `events.kind_id` (many-to-one), so its lifecycle-impact incident set is the
// events that carry it — retiring a kind rewrites none of them (EARS-28).

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** The canonical storage order of a kind's allowed-format set (LD-11). */
export const CANONICAL_FORMAT_ORDER: readonly EventParticipationFormat[] = [
  "online",
  "offline",
  "hybrid",
];

/** Sort a format set into the canonical order so two equal sets compare equal. */
export function canonicalFormats(
  formats: readonly EventParticipationFormat[],
): EventParticipationFormat[] {
  return CANONICAL_FORMAT_ORDER.filter((f) => formats.includes(f));
}

export interface EventKindInsert {
  slug: string;
  title: string;
  allowedFormats: EventParticipationFormat[];
}

/** The editorial patch a PATCH applies. `undefined` means unchanged. */
export interface EventKindPatch {
  title?: string;
  allowedFormats?: EventParticipationFormat[];
}

/** The lifecycle patch a publish / retire / restore applies (012-design §2.1). */
export interface EventKindLifecyclePatch {
  status: "draft" | "published" | "retired";
  deletedAt: Date | null;
  firstPublishedAt?: Date;
}

/**
 * One event that references the kind, in the shape both the §3.1 preview and
 * its fingerprint read. Every referencing event is fingerprinted (a retired or
 * draft one included); only the publicly visible ones are listed.
 */
export interface EventKindIncidentEvent {
  id: string;
  version: number;
  title: string;
  slug: string;
  publiclyVisible: boolean;
  /** `<record_status>:<state>` — what decides whether the event is public. */
  eligibility: string;
}

/** The lifecycle states in which an event is on a public surface. */
const PUBLIC_STATES = new Set(["published", "live", "ended"]);

@Injectable()
export class EventKindsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /** Run `fn` in one audit-attributed transaction. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.db, fn);
  }

  /** The retire/restore boundary (LD-1) — same as the direction vertical. */
  serializableTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.db, fn, {
      isolationLevel: "serializable",
    });
  }

  async insert(tx: Tx, values: EventKindInsert): Promise<EventKind> {
    const [row] = await tx.insert(eventKinds).values(values).returning();
    if (!row) throw new Error("event kind insert returned no row");
    return row;
  }

  async findById(id: string): Promise<EventKind | null> {
    const [row] = await this.db
      .select()
      .from(eventKinds)
      .where(eq(eventKinds.id, id));
    return row ?? null;
  }

  async lockById(tx: Tx, id: string): Promise<EventKind | null> {
    const [row] = await tx
      .select()
      .from(eventKinds)
      .where(eq(eventKinds.id, id))
      .for("update");
    return row ?? null;
  }

  async lockSlugSequence(tx: Tx, base: string): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${base}, 0))`,
    );
  }

  /** Whether `slug` is held by any retained row, a retired kind included. */
  async slugTaken(tx: Tx | Db, slug: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: eventKinds.id })
      .from(eventKinds)
      .where(eq(eventKinds.slug, slug))
      .limit(1);
    return Boolean(row);
  }

  async updateVersioned(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: EventKindPatch,
  ): Promise<EventKind | null> {
    const [row] = await tx
      .update(eventKinds)
      .set({
        ...patch,
        version: sql`${eventKinds.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(eq(eventKinds.id, id), eq(eventKinds.version, expectedVersion)),
      )
      .returning();
    return row ?? null;
  }

  async transitionVersioned(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: EventKindLifecyclePatch,
  ): Promise<EventKind | null> {
    const [row] = await tx
      .update(eventKinds)
      .set({
        ...patch,
        version: sql`${eventKinds.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(eq(eventKinds.id, id), eq(eventKinds.version, expectedVersion)),
      )
      .returning();
    return row ?? null;
  }

  discoverIncidentAnywhere(kindId: string): Promise<EventKindIncidentEvent[]> {
    return this.discoverIncident(this.db, kindId);
  }

  /**
   * Every event that references this kind (012-design §3.1). Retiring the kind
   * changes none of these rows (EARS-28) — they keep the reference — but the
   * operator sees which public events carry the kind before confirming.
   */
  async discoverIncident(
    tx: Tx | Db,
    kindId: string,
  ): Promise<EventKindIncidentEvent[]> {
    const rows = await tx
      .select({
        id: events.id,
        version: events.version,
        title: events.title,
        slug: events.slug,
        state: events.state,
        recordStatus: events.recordStatus,
      })
      .from(events)
      .where(eq(events.kindId, kindId))
      .orderBy(asc(events.id));
    return rows.map((row) => ({
      id: row.id,
      version: row.version,
      title: row.title,
      slug: row.slug,
      publiclyVisible:
        row.recordStatus === "active" && PUBLIC_STATES.has(row.state),
      eligibility: `${row.recordStatus}:${row.state}`,
    }));
  }

  /** The shared admin list read (012-design §5.1) with LD-6's search. */
  async list(
    query: AdminTaxonomyListQuery,
  ): Promise<{ rows: EventKind[]; total: number }> {
    const filters = [];
    if (query.status) {
      filters.push(eq(eventKinds.status, query.status));
    } else if (!query.includeRetired) {
      filters.push(isNull(eventKinds.deletedAt));
    }
    if (query.q) {
      const pattern = `%${escapeLike(query.q.normalize("NFKC"))}%`;
      filters.push(
        or(ilike(eventKinds.title, pattern), ilike(eventKinds.slug, pattern)),
      );
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const rows = await this.db
      .select()
      .from(eventKinds)
      .where(where)
      .orderBy(asc(eventKinds.title), asc(eventKinds.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await this.db
      .select({ value: count() })
      .from(eventKinds)
      .where(where);
    return { rows, total: Number(totals?.value ?? 0) };
  }

  /** EARS-28 — every published, non-retired kind, ordered by title. */
  async listPublic(): Promise<Array<{ id: string; slug: string; title: string }>> {
    return this.db
      .select({
        id: eventKinds.id,
        slug: eventKinds.slug,
        title: eventKinds.title,
      })
      .from(eventKinds)
      .where(and(eq(eventKinds.status, "published"), isNull(eventKinds.deletedAt)))
      .orderBy(asc(eventKinds.title), asc(eventKinds.id));
  }
}

/** Escape the LIKE wildcards so a search for `100%` is a literal search. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

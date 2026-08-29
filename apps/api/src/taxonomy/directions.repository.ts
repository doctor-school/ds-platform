import { Inject, Injectable } from "@nestjs/common";
import {
  aliasedTable,
  and,
  asc,
  count,
  eq,
  ilike,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { DrizzleHandle, Direction } from "@ds/db";
import {
  directionAdjacency,
  directions,
  directionSpecialties,
  specialtiesMinzdrav,
} from "@ds/db";
import type { AdminTaxonomyListQuery } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";

// 012 EARS-3 (#1285) — Drizzle data access for the `directions` aggregate, shaped
// exactly like `ProjectsRepository` / `ExpertsRepository`: every mutating path
// runs through `withRequestAuditContext`, so feature 010's capture trigger
// attributes the resulting `data.directions.*` ledger rows to the acting admin
// without this layer knowing who that is. A direction title is ordinary audited
// editorial text (012-design §6) — no masked-column registry entry.

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface DirectionInsert {
  slug: string;
  title: string;
}

/**
 * The field patch a PATCH applies. `undefined` means unchanged. Slug never
 * appears: it is generated once and retained for the row's lifetime.
 */
export interface DirectionPatch {
  title?: string;
}

/**
 * The lifecycle patch a publish / retire / restore applies (012-design §2.1).
 * The three columns move TOGETHER or not at all: the table's
 * `directions_retired_iff_deleted` CHECK makes `status = 'retired'` and a
 * non-null `deleted_at` one fact, and `first_published_at` is the set-once
 * stamp the first publish writes (LD-3).
 */
export interface DirectionLifecyclePatch {
  status: "draft" | "published" | "retired";
  deletedAt: Date | null;
  firstPublishedAt?: Date;
}

/**
 * One retained join a direction is an endpoint of, in the shape both the
 * §3.1 preview list and its fingerprint read: the join's own identity and
 * lifecycle, plus the operator-readable label of the OPPOSITE endpoint.
 */
export interface DirectionIncidentRelation {
  kind: "direction↔specialty" | "direction↔direction";
  id: string;
  version: number;
  status: "active" | "retired";
  /** «<направление> — <вторая сторона>» — the pairing an operator reads. */
  title: string;
  /**
   * The opposite endpoint's public-eligibility input. A specialty is an entry
   * of the CLOSED Минздрав book and has no lifecycle of its own, so it reads
   * `closed-book`; an adjacent direction contributes its own status, because an
   * endpoint that became published between preview and confirmation changes
   * what the confirmed transition would expose.
   */
  eligibility: string;
}

export interface DirectionAdjacencyFingerprintRow {
  sourceId: string;
  sourceStatus: Direction["status"];
  adjacentDirectionId: string;
  adjacentStatus: Direction["status"];
}

/**
 * Resolve the lifecycle input of the endpoint opposite the direction whose
 * impact is being reviewed. An inbound A→B edge reviewed from B must fingerprint
 * A, just as an outbound B→C edge reviewed from B fingerprints C.
 */
export function oppositeDirectionStatus(
  reviewedDirectionId: string,
  edge: DirectionAdjacencyFingerprintRow,
): Direction["status"] {
  if (edge.sourceId === reviewedDirectionId) return edge.adjacentStatus;
  if (edge.adjacentDirectionId === reviewedDirectionId) {
    return edge.sourceStatus;
  }
  throw new Error(
    "reviewed direction is not an endpoint of the adjacency edge",
  );
}

@Injectable()
export class DirectionsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /** Run `fn` in one audit-attributed transaction. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.db, fn);
  }

  /**
   * The retire/restore boundary (LD-1): `SERIALIZABLE`, because the impact
   * fingerprint recomputed inside it must see a snapshot no concurrent join
   * write can have moved under it. A publish keeps the ordinary boundary — it
   * binds no dependency snapshot.
   */
  serializableTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.db, fn, {
      isolationLevel: "serializable",
    });
  }

  async insert(tx: Tx, values: DirectionInsert): Promise<Direction> {
    const [row] = await tx.insert(directions).values(values).returning();
    if (!row) throw new Error("direction insert returned no row");
    return row;
  }

  async findById(id: string): Promise<Direction | null> {
    const [row] = await this.db
      .select()
      .from(directions)
      .where(eq(directions.id, id));
    return row ?? null;
  }

  /** Read the row FOR UPDATE inside a transaction — the PATCH concurrency boundary. */
  async lockById(tx: Tx, id: string): Promise<Direction | null> {
    const [row] = await tx
      .select()
      .from(directions)
      .where(eq(directions.id, id))
      .for("update");
    return row ?? null;
  }

  /**
   * Serialize allocation of one derived slug sequence (`base`, `base-2`, ...).
   * Hash collisions only serialize unrelated names; they cannot corrupt identity.
   */
  async lockSlugSequence(tx: Tx, base: string): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${base}, 0))`,
    );
  }

  /**
   * Whether `slug` is held by any retained row — a retired
   * direction included (012-design §2.1): nothing in 012 is physically deleted, so a
   * retired direction permanently keeps its slug and the URL can never later resolve
   * to a different subject.
   */
  async slugTaken(tx: Tx | Db, slug: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: directions.id })
      .from(directions)
      .where(eq(directions.slug, slug))
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
    patch: DirectionPatch,
  ): Promise<Direction | null> {
    const [row] = await tx
      .update(directions)
      .set({
        ...patch,
        version: sql`${directions.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(eq(directions.id, id), eq(directions.version, expectedVersion)),
      )
      .returning();
    return row ?? null;
  }

  /**
   * Apply a LIFECYCLE move and bump `version` in one statement, guarded by the
   * caller's expected version. Zero rows ⇒ the row moved under the caller (412).
   * Separate from {@link updateVersioned} on purpose: an editorial PATCH must
   * never be able to reach `status` / `deleted_at`, and one shared patch type
   * would make that a typo away.
   */
  async transitionVersioned(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: DirectionLifecyclePatch,
  ): Promise<Direction | null> {
    const [row] = await tx
      .update(directions)
      .set({
        ...patch,
        version: sql`${directions.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(eq(directions.id, id), eq(directions.version, expectedVersion)),
      )
      .returning();
    return row ?? null;
  }

  /** {@link discoverIncident} against the pool — the optimistic preview read. */
  discoverIncidentAnywhere(
    directionId: string,
  ): Promise<DirectionIncidentRelation[]> {
    return this.discoverIncident(this.db, directionId);
  }

  /**
   * Every retained join this direction is an endpoint of (012-design §3.1).
   *
   * RETIRED joins are included, and so are edges pointing AT this direction:
   * the fingerprint has to cover what a restore would put back and what a
   * neighbour's own edge would expose, not only what is visible today. Retiring
   * a direction changes none of these rows (EARS-13) — it changes what they
   * resolve to, which is exactly what the operator is shown before confirming.
   */
  async discoverIncident(
    tx: Tx | Db,
    directionId: string,
  ): Promise<DirectionIncidentRelation[]> {
    const self = aliasedTable(directions, "self_direction");
    const other = aliasedTable(directions, "other_direction");

    const specialtyRows = await tx
      .select({
        id: directionSpecialties.id,
        version: directionSpecialties.version,
        status: directionSpecialties.status,
        directionTitle: self.title,
        specialtyName: specialtiesMinzdrav.name,
      })
      .from(directionSpecialties)
      .innerJoin(self, eq(self.id, directionSpecialties.directionId))
      .innerJoin(
        specialtiesMinzdrav,
        eq(specialtiesMinzdrav.id, directionSpecialties.specialtyMinzdravId),
      )
      .where(eq(directionSpecialties.directionId, directionId));

    const adjacencyRows = await tx
      .select({
        id: directionAdjacency.id,
        version: directionAdjacency.version,
        status: directionAdjacency.status,
        sourceId: directionAdjacency.directionId,
        sourceTitle: self.title,
        sourceStatus: self.status,
        adjacentDirectionId: directionAdjacency.adjacentDirectionId,
        adjacentTitle: other.title,
        adjacentStatus: other.status,
      })
      .from(directionAdjacency)
      .innerJoin(self, eq(self.id, directionAdjacency.directionId))
      .innerJoin(other, eq(other.id, directionAdjacency.adjacentDirectionId))
      .where(
        or(
          eq(directionAdjacency.directionId, directionId),
          eq(directionAdjacency.adjacentDirectionId, directionId),
        ),
      );

    return [
      ...specialtyRows.map((row) => ({
        kind: "direction↔specialty" as const,
        id: row.id,
        version: row.version,
        status: row.status,
        title: `${row.directionTitle} — ${row.specialtyName}`,
        eligibility: "closed-book",
      })),
      ...adjacencyRows.map((row) => ({
        kind: "direction↔direction" as const,
        id: row.id,
        version: row.version,
        status: row.status,
        title: `${row.sourceTitle} — ${row.adjacentTitle}`,
        eligibility: oppositeDirectionStatus(directionId, row),
      })),
      // Stable order so two reads of an unchanged world fingerprint identically
      // — an unordered set would make the digest depend on the planner.
    ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /**
   * The shared admin list read (012-design §5.1) with LD-6's search: offset
   * pagination, `ILIKE '%q%'` over `title` and `slug` served by the pg_trgm GIN
   * indexes from migration 0017, explicit status filter, retired rows excluded
   * unless asked for. The predicate is SQL, never a full-roster scan filtered in
   * application code (EARS-15).
   */
  async list(
    query: AdminTaxonomyListQuery,
  ): Promise<{ rows: Direction[]; total: number }> {
    const filters = [];
    if (query.status) {
      filters.push(eq(directions.status, query.status));
    } else if (!query.includeRetired) {
      filters.push(isNull(directions.deletedAt));
    }
    if (query.q) {
      // NFKC first: two visually identical inputs (a composed «й» and its
      // decomposed twin) must behave the same, and the stored column is NFKC
      // too, so normalizing here is what makes the comparison honest rather
      // than a lucky byte match (012-design §2.2 LD-6).
      const pattern = `%${escapeLike(query.q.normalize("NFKC"))}%`;
      filters.push(
        or(ilike(directions.title, pattern), ilike(directions.slug, pattern)),
      );
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const rows = await this.db
      .select()
      .from(directions)
      .where(where)
      // Stable total order ending in id — two rows updated in the same
      // millisecond must not swap places between pages.
      .orderBy(asc(directions.title), asc(directions.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await this.db
      .select({ value: count() })
      .from(directions)
      .where(where);
    return { rows, total: Number(totals?.value ?? 0) };
  }
}

/** Escape the LIKE wildcards so a search for `100%` is a literal search. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

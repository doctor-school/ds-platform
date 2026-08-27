import { Inject, Injectable } from "@nestjs/common";
import { aliasedTable, and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { Direction, DirectionAdjacency, DrizzleHandle } from "@ds/db";
import { directionAdjacency, directions } from "@ds/db";
import type { DirectionAdjacencyAdminListQuery } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";

// #1483 (ADR-0016 §2.8, 017-design §5) — Drizzle data access for the DIRECTED
// `direction_adjacency` self-relation. Both endpoints are `directions`, so every
// read aliases the table twice: `directions` as the source end and
// `adjacent_directions` as the target end.
//
// Same audit posture as every other relation repository: mutating paths open
// their transaction through `withRequestAuditContext` so feature 010's capture
// trigger attributes the ledger rows to the acting admin.

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** The target end of the edge, aliased so one query can read both ends. */
const adjacentDirections = aliasedTable(directions, "adjacent_directions");

/** One edge joined to both ends' display forms. */
export interface DirectionAdjacencyRow {
  relation: DirectionAdjacency;
  direction: Pick<Direction, "id" | "slug" | "title" | "status">;
  adjacent: Pick<Direction, "id" | "slug" | "title" | "status">;
}

/** The lifecycle patch a retire/restore applies. */
export interface EdgeLifecyclePatch {
  status: "active" | "retired";
  deletedAt: Date | null;
}

/** The attribute patch a PATCH applies — the endpoints are never patchable. */
export interface EdgeAttributePatch {
  kind?: string | undefined;
  weight?: number | undefined;
}

const ENDPOINT_COLUMNS = {
  directionId: directions.id,
  directionSlug: directions.slug,
  directionTitle: directions.title,
  directionStatus: directions.status,
  adjacentId: adjacentDirections.id,
  adjacentSlug: adjacentDirections.slug,
  adjacentTitle: adjacentDirections.title,
  adjacentStatus: adjacentDirections.status,
} as const;

type EndpointRow = {
  directionId: string;
  directionSlug: string;
  directionTitle: string;
  directionStatus: Direction["status"];
  adjacentId: string;
  adjacentSlug: string;
  adjacentTitle: string;
  adjacentStatus: Direction["status"];
};

function endpoints(
  row: EndpointRow,
): Pick<DirectionAdjacencyRow, "direction" | "adjacent"> {
  return {
    direction: {
      id: row.directionId,
      slug: row.directionSlug,
      title: row.directionTitle,
      status: row.directionStatus,
    },
    adjacent: {
      id: row.adjacentId,
      slug: row.adjacentSlug,
      title: row.adjacentTitle,
      status: row.adjacentStatus,
    },
  };
}

@Injectable()
export class DirectionAdjacencyRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /** Run `fn` in one audit-attributed transaction. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.db, fn);
  }

  async insert(
    tx: Tx,
    values: {
      directionId: string;
      adjacentDirectionId: string;
      kind: string;
      weight: number;
    },
  ): Promise<DirectionAdjacency> {
    const [row] = await tx.insert(directionAdjacency).values(values).returning();
    if (!row) throw new Error("direction_adjacency insert returned no row");
    return row;
  }

  async findById(id: string): Promise<DirectionAdjacency | null> {
    const [row] = await this.db
      .select()
      .from(directionAdjacency)
      .where(eq(directionAdjacency.id, id));
    return row ?? null;
  }

  /**
   * Read the edge FOR UPDATE together with both ends, locking the two
   * `directions` rows in id order first. Both ends live in the SAME table, so
   * the canonical order cannot be "source before target" — two commands moving
   * the mirrored edges of one pair would then lock the same two rows in opposite
   * orders and deadlock. Ordering by id is the only total order available.
   */
  async lockForWrite(
    tx: Tx,
    id: string,
  ): Promise<DirectionAdjacencyRow | null> {
    const [existing] = await tx
      .select()
      .from(directionAdjacency)
      .where(eq(directionAdjacency.id, id));
    if (!existing) return null;

    const ends = [existing.directionId, existing.adjacentDirectionId].sort();
    for (const endId of ends) {
      await tx
        .select({ id: directions.id })
        .from(directions)
        .where(eq(directions.id, endId))
        .for("update");
    }

    const [locked] = await tx
      .select()
      .from(directionAdjacency)
      .where(eq(directionAdjacency.id, id))
      .for("update");
    if (!locked) return null;
    return this.hydrate(tx, locked);
  }

  /** Join one edge row to both ends' display forms. */
  async hydrate(
    tx: Tx | Db,
    relation: DirectionAdjacency,
  ): Promise<DirectionAdjacencyRow> {
    const [row] = await tx
      .select(ENDPOINT_COLUMNS)
      .from(directions)
      .innerJoin(
        adjacentDirections,
        eq(adjacentDirections.id, relation.adjacentDirectionId),
      )
      .where(eq(directions.id, relation.directionId));
    if (!row) {
      // Both FKs are RESTRICT and nothing here is physically deleted, so an end
      // cannot vanish under an edge. Reaching here means the database no longer
      // satisfies its own constraints.
      throw new Error("direction_adjacency row has an unresolvable endpoint");
    }
    return { relation, ...endpoints(row) };
  }

  async detailById(id: string): Promise<DirectionAdjacencyRow | null> {
    const relation = await this.findById(id);
    if (!relation) return null;
    return this.hydrate(this.db, relation);
  }

  /**
   * The logical ORDERED pair, active or retired (`direction_adjacency_pair_key`
   * spans both). The reverse pair is a DIFFERENT edge by design and is not
   * looked up here.
   */
  async findPair(
    tx: Tx | Db,
    directionId: string,
    adjacentDirectionId: string,
  ): Promise<DirectionAdjacency | null> {
    const [row] = await tx
      .select()
      .from(directionAdjacency)
      .where(
        and(
          eq(directionAdjacency.directionId, directionId),
          eq(directionAdjacency.adjacentDirectionId, adjacentDirectionId),
        ),
      );
    return row ?? null;
  }

  async findDirection(tx: Tx | Db, id: string): Promise<Direction | null> {
    const [row] = await tx
      .select()
      .from(directions)
      .where(eq(directions.id, id));
    return row ?? null;
  }

  /** Apply the attribute patch and bump `version`, guarded by the expected one. */
  async updateVersioned(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: EdgeAttributePatch,
  ): Promise<DirectionAdjacency | null> {
    const [row] = await tx
      .update(directionAdjacency)
      .set({
        ...(patch.kind === undefined ? {} : { kind: patch.kind }),
        ...(patch.weight === undefined ? {} : { weight: patch.weight }),
        version: sql`${directionAdjacency.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(directionAdjacency.id, id),
          eq(directionAdjacency.version, expectedVersion),
        ),
      )
      .returning();
    return row ?? null;
  }

  /**
   * Move the edge's lifecycle and bump `version` in one statement, guarded by
   * the caller's expected version. The row's IDENTITY never changes: a restore
   * is this UPDATE, never an INSERT.
   */
  async transitionVersioned(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: EdgeLifecyclePatch,
  ): Promise<DirectionAdjacency | null> {
    const [row] = await tx
      .update(directionAdjacency)
      .set({
        status: patch.status,
        deletedAt: patch.deletedAt,
        version: sql`${directionAdjacency.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(directionAdjacency.id, id),
          eq(directionAdjacency.version, expectedVersion),
        ),
      )
      .returning();
    return row ?? null;
  }

  /** The filtered admin list: offset pagination, either END may scope it. */
  async list(
    query: DirectionAdjacencyAdminListQuery,
  ): Promise<{ rows: DirectionAdjacencyRow[]; total: number }> {
    const filters = [];
    if (query.directionId) {
      filters.push(eq(directionAdjacency.directionId, query.directionId));
    }
    if (query.adjacentDirectionId) {
      filters.push(
        eq(directionAdjacency.adjacentDirectionId, query.adjacentDirectionId),
      );
    }
    if (query.kind) filters.push(eq(directionAdjacency.kind, query.kind));
    if (query.status) {
      filters.push(eq(directionAdjacency.status, query.status));
    } else if (!query.includeRetired) {
      filters.push(isNull(directionAdjacency.deletedAt));
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const rows = await this.db
      .select({ relation: directionAdjacency, ...ENDPOINT_COLUMNS })
      .from(directionAdjacency)
      .innerJoin(directions, eq(directions.id, directionAdjacency.directionId))
      .innerJoin(
        adjacentDirections,
        eq(adjacentDirections.id, directionAdjacency.adjacentDirectionId),
      )
      .where(where)
      // Heaviest edge first inside a source direction — the order the operator
      // reasons about — then the edge id, so two equal weights never swap
      // places between pages.
      .orderBy(
        asc(directions.title),
        desc(directionAdjacency.weight),
        asc(directionAdjacency.id),
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await this.db
      .select({ value: count() })
      .from(directionAdjacency)
      .where(where);

    return {
      rows: rows.map((row) => ({ relation: row.relation, ...endpoints(row) })),
      total: Number(totals?.value ?? 0),
    };
  }
}

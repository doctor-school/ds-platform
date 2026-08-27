import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import type {
  Direction,
  DirectionSpecialty,
  DrizzleHandle,
  SpecialtyMinzdrav,
} from "@ds/db";
import { directions, directionSpecialties, specialtiesMinzdrav } from "@ds/db";
import type { DirectionSpecialtyAdminListQuery } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";

// #1483 (ADR-0016 §2.8, 017-design §5) — Drizzle data access for the
// `direction_specialties` link. Posture copied from `event-projects.repository.ts`
// unchanged: every mutating path opens its transaction through
// `withRequestAuditContext`, so feature 010's capture trigger attributes the
// resulting ledger rows to the acting admin without this layer knowing who that
// is.
//
// What this repository does NOT own, deliberately: a §3.1 lifecycle-impact
// discovery read. That machinery is 012's contract for the joins whose
// retirement withdraws a PUBLIC projection; a direction↔specialty link is
// reference-book configuration whose only consumer is the 017 targeting
// resolution, which reads live rows on every request.

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** One link joined to both endpoints' display forms (017-design §5). */
export interface DirectionSpecialtyRow {
  relation: DirectionSpecialty;
  direction: Pick<Direction, "id" | "slug" | "title" | "status">;
  specialty: Pick<SpecialtyMinzdrav, "id" | "code" | "name">;
}

/** The lifecycle patch a retire/restore applies. */
export interface LinkLifecyclePatch {
  status: "active" | "retired";
  deletedAt: Date | null;
}

@Injectable()
export class DirectionSpecialtiesRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /** Run `fn` in one audit-attributed transaction. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.db, fn);
  }

  async insert(
    tx: Tx,
    values: { directionId: string; specialtyMinzdravId: string },
  ): Promise<DirectionSpecialty> {
    const [row] = await tx
      .insert(directionSpecialties)
      .values(values)
      .returning();
    if (!row) throw new Error("direction_specialties insert returned no row");
    return row;
  }

  async findById(id: string): Promise<DirectionSpecialty | null> {
    const [row] = await this.db
      .select()
      .from(directionSpecialties)
      .where(eq(directionSpecialties.id, id));
    return row ?? null;
  }

  /**
   * Read the link FOR UPDATE together with both endpoints, in the LD-2/LD-4
   * canonical lock order a relation command uses: the endpoint rows before the
   * join row, never target-first — inverting that order deadlocks against an
   * entity command under load.
   */
  async lockForTransition(
    tx: Tx,
    id: string,
  ): Promise<DirectionSpecialtyRow | null> {
    const [existing] = await tx
      .select()
      .from(directionSpecialties)
      .where(eq(directionSpecialties.id, id));
    if (!existing) return null;

    await tx
      .select({ id: directions.id })
      .from(directions)
      .where(eq(directions.id, existing.directionId))
      .for("update");
    await tx
      .select({ id: specialtiesMinzdrav.id })
      .from(specialtiesMinzdrav)
      .where(eq(specialtiesMinzdrav.id, existing.specialtyMinzdravId))
      .for("update");

    const [locked] = await tx
      .select()
      .from(directionSpecialties)
      .where(eq(directionSpecialties.id, id))
      .for("update");
    if (!locked) return null;
    return this.hydrate(tx, locked);
  }

  /** Join one link row to both endpoints' display forms. */
  async hydrate(
    tx: Tx | Db,
    relation: DirectionSpecialty,
  ): Promise<DirectionSpecialtyRow> {
    const [row] = await tx
      .select({
        directionId: directions.id,
        directionSlug: directions.slug,
        directionTitle: directions.title,
        directionStatus: directions.status,
        specialtyId: specialtiesMinzdrav.id,
        specialtyCode: specialtiesMinzdrav.code,
        specialtyName: specialtiesMinzdrav.name,
      })
      .from(directions)
      .innerJoin(
        specialtiesMinzdrav,
        eq(specialtiesMinzdrav.id, relation.specialtyMinzdravId),
      )
      .where(eq(directions.id, relation.directionId));
    if (!row) {
      // Both FKs are RESTRICT and nothing here is physically deleted, so an
      // endpoint cannot vanish under a link. Reaching here means the database
      // no longer satisfies its own constraints.
      throw new Error("direction_specialties row has an unresolvable endpoint");
    }
    return {
      relation,
      direction: {
        id: row.directionId,
        slug: row.directionSlug,
        title: row.directionTitle,
        status: row.directionStatus,
      },
      specialty: {
        id: row.specialtyId,
        code: row.specialtyCode,
        name: row.specialtyName,
      },
    };
  }

  async detailById(id: string): Promise<DirectionSpecialtyRow | null> {
    const relation = await this.findById(id);
    if (!relation) return null;
    return this.hydrate(this.db, relation);
  }

  /**
   * The logical pair, ACTIVE OR RETIRED (`direction_specialties_pair_key` spans
   * both). A retired pair is what turns a duplicate create into «restore that
   * link instead», rather than a second row for one relationship.
   */
  async findPair(
    tx: Tx | Db,
    directionId: string,
    specialtyMinzdravId: string,
  ): Promise<DirectionSpecialty | null> {
    const [row] = await tx
      .select()
      .from(directionSpecialties)
      .where(
        and(
          eq(directionSpecialties.directionId, directionId),
          eq(directionSpecialties.specialtyMinzdravId, specialtyMinzdravId),
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

  async findSpecialty(
    tx: Tx | Db,
    id: string,
  ): Promise<SpecialtyMinzdrav | null> {
    const [row] = await tx
      .select()
      .from(specialtiesMinzdrav)
      .where(eq(specialtiesMinzdrav.id, id));
    return row ?? null;
  }

  /**
   * Move the link's lifecycle and bump `version` in one statement, guarded by
   * the caller's expected version. Zero rows ⇒ the row moved under the caller.
   * The row's IDENTITY never changes: a restore is this UPDATE, never an INSERT.
   */
  async transitionVersioned(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: LinkLifecyclePatch,
  ): Promise<DirectionSpecialty | null> {
    const [row] = await tx
      .update(directionSpecialties)
      .set({
        status: patch.status,
        deletedAt: patch.deletedAt,
        version: sql`${directionSpecialties.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(directionSpecialties.id, id),
          eq(directionSpecialties.version, expectedVersion),
        ),
      )
      .returning();
    return row ?? null;
  }

  /** The filtered admin list: offset pagination, either endpoint scopes it. */
  async list(
    query: DirectionSpecialtyAdminListQuery,
  ): Promise<{ rows: DirectionSpecialtyRow[]; total: number }> {
    const filters = [];
    if (query.directionId) {
      filters.push(eq(directionSpecialties.directionId, query.directionId));
    }
    if (query.specialtyMinzdravId) {
      filters.push(
        eq(
          directionSpecialties.specialtyMinzdravId,
          query.specialtyMinzdravId,
        ),
      );
    }
    if (query.status) {
      filters.push(eq(directionSpecialties.status, query.status));
    } else if (!query.includeRetired) {
      filters.push(isNull(directionSpecialties.deletedAt));
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const rows = await this.db
      .select({
        relation: directionSpecialties,
        directionId: directions.id,
        directionSlug: directions.slug,
        directionTitle: directions.title,
        directionStatus: directions.status,
        specialtyId: specialtiesMinzdrav.id,
        specialtyCode: specialtiesMinzdrav.code,
        specialtyName: specialtiesMinzdrav.name,
      })
      .from(directionSpecialties)
      .innerJoin(directions, eq(directions.id, directionSpecialties.directionId))
      .innerJoin(
        specialtiesMinzdrav,
        eq(specialtiesMinzdrav.id, directionSpecialties.specialtyMinzdravId),
      )
      .where(where)
      // Stable total order ending in the link id — two rows created in the same
      // millisecond must not swap places between pages.
      .orderBy(
        asc(directions.title),
        asc(specialtiesMinzdrav.code),
        asc(directionSpecialties.id),
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await this.db
      .select({ value: count() })
      .from(directionSpecialties)
      .where(where);

    return {
      rows: rows.map((row) => ({
        relation: row.relation,
        direction: {
          id: row.directionId,
          slug: row.directionSlug,
          title: row.directionTitle,
          status: row.directionStatus,
        },
        specialty: {
          id: row.specialtyId,
          code: row.specialtyCode,
          name: row.specialtyName,
        },
      })),
      total: Number(totals?.value ?? 0),
    };
  }
}

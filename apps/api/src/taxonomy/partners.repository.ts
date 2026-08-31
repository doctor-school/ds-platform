import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { DrizzleHandle, Partner } from "@ds/db";
import { partners } from "@ds/db";
import type { AdminTaxonomyListQuery } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";

// 012 EARS-4 (#1286) — Drizzle data access for the `partners` aggregate, shaped
// exactly like `ProjectsRepository` / `ExpertsRepository`: every mutating path
// runs through `withRequestAuditContext`, so feature 010's capture trigger
// attributes the resulting `data.partners.*` ledger rows to the acting admin
// without this layer knowing who that is. A partner's title and website are
// ordinary audited columns (012-design §6) — no masked-column registry entry.

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface PartnerInsert {
  slug: string;
  title: string;
  websiteUrl: string | null;
  logoRef: string | null;
}

/** The field patch a PATCH applies. `undefined` means unchanged. */
export interface PartnerPatch {
  title?: string;
  websiteUrl?: string | null;
  /** `undefined` keeps the current reference; `null` clears it; a string replaces it. */
  logoRef?: string | null;
}

/** The lifecycle columns a publish/retire/restore moves (012-design §2.1). */
export interface PartnerLifecyclePatch {
  status?: "draft" | "published" | "retired";
  deletedAt?: Date | null;
  /** Written by the FIRST publish only; never re-stamped (LD-3). */
  firstPublishedAt?: Date;
}

@Injectable()
export class PartnersRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /** Run `fn` in one audit-attributed transaction. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.db, fn);
  }

  /** Serialize allocation of one derived retained slug sequence. */
  async lockSlugSequence(tx: Tx, base: string): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${base}, 0))`,
    );
  }

  async insert(tx: Tx, values: PartnerInsert): Promise<Partner> {
    const [row] = await tx.insert(partners).values(values).returning();
    if (!row) throw new Error("partner insert returned no row");
    return row;
  }

  async findById(id: string): Promise<Partner | null> {
    const [row] = await this.db
      .select()
      .from(partners)
      .where(eq(partners.id, id));
    return row ?? null;
  }

  /** Read the row FOR UPDATE inside a transaction — the PATCH concurrency boundary. */
  async lockById(tx: Tx, id: string): Promise<Partner | null> {
    const [row] = await tx
      .select()
      .from(partners)
      .where(eq(partners.id, id))
      .for("update");
    return row ?? null;
  }

  /**
   * Whether `slug` is held by any retained row, retired ones included
   * (012-design §2.1): a retired partner permanently keeps its
   * slug, so the public URL can never later resolve to a different organization.
   */
  async slugTaken(tx: Tx | Db, slug: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: partners.id })
      .from(partners)
      .where(eq(partners.slug, slug))
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
    patch: PartnerPatch,
  ): Promise<Partner | null> {
    const [row] = await tx
      .update(partners)
      .set({
        ...patch,
        version: sql`${partners.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(partners.id, id), eq(partners.version, expectedVersion)))
      .returning();
    return row ?? null;
  }

  /**
   * Move the row's LIFECYCLE and bump `version`, guarded by the expected
   * version. Separate from {@link updateVersioned} because a lifecycle move
   * writes columns a PATCH may never touch — `status`, `deleted_at` and the
   * write-once `first_published_at` (012-design §2.1/LD-3).
   */
  async transitionVersioned(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: PartnerLifecyclePatch,
  ): Promise<Partner | null> {
    const [row] = await tx
      .update(partners)
      .set({
        ...patch,
        version: sql`${partners.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(partners.id, id), eq(partners.version, expectedVersion)))
      .returning();
    return row ?? null;
  }

  /**
   * The shared admin list read (012-design §5.1) with LD-6's search: offset
   * pagination, `ILIKE '%q%'` over `title` and `slug` served by the pg_trgm GIN
   * indexes from this vertical's migration, explicit status filter, retired rows
   * excluded unless asked for. The predicate is SQL, never a full-roster scan
   * filtered in application code (EARS-15).
   */
  async list(
    query: AdminTaxonomyListQuery,
  ): Promise<{ rows: Partner[]; total: number }> {
    const filters = [];
    if (query.status) {
      filters.push(eq(partners.status, query.status));
    } else if (!query.includeRetired) {
      filters.push(isNull(partners.deletedAt));
    }
    if (query.q) {
      // NFKC first: two visually identical inputs (a composed «й» and its
      // decomposed twin) must behave the same, and the stored column is NFKC
      // too, so normalizing here is what makes the comparison honest rather
      // than a lucky byte match (012-design §2.2 LD-6).
      const pattern = `%${escapeLike(query.q.normalize("NFKC"))}%`;
      filters.push(
        or(ilike(partners.title, pattern), ilike(partners.slug, pattern)),
      );
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const rows = await this.db
      .select()
      .from(partners)
      .where(where)
      // Stable total order ending in id — two rows updated in the same
      // millisecond must not swap places between pages.
      .orderBy(asc(partners.title), asc(partners.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await this.db
      .select({ value: count() })
      .from(partners)
      .where(where);
    return { rows, total: Number(totals?.value ?? 0) };
  }
}

/** Escape the LIKE wildcards so a search for `100%` is a literal search. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

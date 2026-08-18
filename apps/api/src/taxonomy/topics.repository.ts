import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, ilike, isNull, ne, or, sql } from "drizzle-orm";
import type { DrizzleHandle, Topic } from "@ds/db";
import { topics } from "@ds/db";
import type { AdminTaxonomyListQuery } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";

// 012 EARS-3 (#1285) — Drizzle data access for the `topics` aggregate, shaped
// exactly like `ProjectsRepository` / `ExpertsRepository`: every mutating path
// runs through `withRequestAuditContext`, so feature 010's capture trigger
// attributes the resulting `data.topics.*` ledger rows to the acting admin
// without this layer knowing who that is. A topic title is ordinary audited
// editorial text (012-design §6) — no masked-column registry entry.

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface TopicInsert {
  slug: string;
  title: string;
}

/** The field patch a PATCH applies. `undefined` means unchanged. */
export interface TopicPatch {
  slug?: string;
  title?: string;
}

@Injectable()
export class TopicsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /** Run `fn` in one audit-attributed transaction. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.db, fn);
  }

  async insert(tx: Tx, values: TopicInsert): Promise<Topic> {
    const [row] = await tx.insert(topics).values(values).returning();
    if (!row) throw new Error("topic insert returned no row");
    return row;
  }

  async findById(id: string): Promise<Topic | null> {
    const [row] = await this.db.select().from(topics).where(eq(topics.id, id));
    return row ?? null;
  }

  /** Read the row FOR UPDATE inside a transaction — the PATCH concurrency boundary. */
  async lockById(tx: Tx, id: string): Promise<Topic | null> {
    const [row] = await tx
      .select()
      .from(topics)
      .where(eq(topics.id, id))
      .for("update");
    return row ?? null;
  }

  /** {@link slugTaken} against the pool — the optimistic pre-flight read. */
  slugTakenAnywhere(slug: string, exceptId?: string): Promise<boolean> {
    return this.slugTaken(this.db, slug, exceptId);
  }

  /**
   * Whether `slug` is held by any retained row other than `exceptId` — a retired
   * topic included (012-design §2.1): nothing in 012 is physically deleted, so a
   * retired topic permanently keeps its slug and the URL can never later resolve
   * to a different subject. Checked before the write for a naming 409; the
   * unique index remains the final race guard.
   */
  async slugTaken(tx: Tx | Db, slug: string, exceptId?: string): Promise<boolean> {
    const where = exceptId
      ? and(eq(topics.slug, slug), ne(topics.id, exceptId))
      : eq(topics.slug, slug);
    const [row] = await tx
      .select({ id: topics.id })
      .from(topics)
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
    patch: TopicPatch,
  ): Promise<Topic | null> {
    const [row] = await tx
      .update(topics)
      .set({
        ...patch,
        version: sql`${topics.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(topics.id, id), eq(topics.version, expectedVersion)))
      .returning();
    return row ?? null;
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
  ): Promise<{ rows: Topic[]; total: number }> {
    const filters = [];
    if (query.status) {
      filters.push(eq(topics.status, query.status));
    } else if (!query.includeRetired) {
      filters.push(isNull(topics.deletedAt));
    }
    if (query.q) {
      // NFKC first: two visually identical inputs (a composed «й» and its
      // decomposed twin) must behave the same, and the stored column is NFKC
      // too, so normalizing here is what makes the comparison honest rather
      // than a lucky byte match (012-design §2.2 LD-6).
      const pattern = `%${escapeLike(query.q.normalize("NFKC"))}%`;
      filters.push(or(ilike(topics.title, pattern), ilike(topics.slug, pattern)));
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const rows = await this.db
      .select()
      .from(topics)
      .where(where)
      // Stable total order ending in id — two rows updated in the same
      // millisecond must not swap places between pages.
      .orderBy(asc(topics.title), asc(topics.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await this.db
      .select({ value: count() })
      .from(topics)
      .where(where);
    return { rows, total: Number(totals?.value ?? 0) };
  }
}

/** Escape the LIKE wildcards so a search for `100%` is a literal search. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

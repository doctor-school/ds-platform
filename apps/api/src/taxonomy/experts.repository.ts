import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, ilike, isNull, ne, or, sql } from "drizzle-orm";
import type { DrizzleHandle, Expert } from "@ds/db";
import { experts, users } from "@ds/db";
import type {
  AdminTaxonomyListQuery,
  EligibleExpertUserOption,
  EligibleExpertUserQuery,
} from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";

// 012 EARS-2 (#1284) — Drizzle data access for the `experts` aggregate, shaped
// exactly like `ProjectsRepository`: every mutating path runs through
// `withRequestAuditContext`, so feature 010's capture trigger attributes the
// resulting `data.experts.*` ledger rows to the acting admin without this layer
// knowing who that is. Expert values are ordinary audited columns (012-design
// §6) — no masked-column registry entry, no separate classification workflow.

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface ExpertInsert {
  slug: string;
  familyName: string;
  givenName: string;
  patronymic: string | null;
  userId: string | null;
  professionalRole: string | null;
  credentials: string | null;
  affiliation: string | null;
  bio: string | null;
  photoRef: string | null;
}

/** The field patch a PATCH applies. `undefined` means unchanged. */
export interface ExpertPatch {
  slug?: string;
  familyName?: string;
  givenName?: string;
  patronymic?: string | null;
  userId?: string | null;
  professionalRole?: string | null;
  credentials?: string | null;
  affiliation?: string | null;
  bio?: string | null;
  /** `undefined` keeps the current reference; `null` clears it; a string replaces it. */
  photoRef?: string | null;
}

@Injectable()
export class ExpertsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /** Run `fn` in one audit-attributed transaction. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.db, fn);
  }

  async insert(tx: Tx, values: ExpertInsert): Promise<Expert> {
    const [row] = await tx.insert(experts).values(values).returning();
    if (!row) throw new Error("expert insert returned no row");
    return row;
  }

  async findById(id: string): Promise<Expert | null> {
    const [row] = await this.db
      .select()
      .from(experts)
      .where(eq(experts.id, id));
    return row ?? null;
  }

  /** Read the row FOR UPDATE inside a transaction — the PATCH concurrency boundary. */
  async lockById(tx: Tx, id: string): Promise<Expert | null> {
    const [row] = await tx
      .select()
      .from(experts)
      .where(eq(experts.id, id))
      .for("update");
    return row ?? null;
  }

  /** Lock the requested User and return whether another Expert already owns it. */
  async lockUserAndFindOwner(
    tx: Tx,
    userId: string,
    exceptExpertId?: string,
  ): Promise<{ exists: boolean; owned: boolean }> {
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!user) return { exists: false, owned: false };

    const ownerWhere = exceptExpertId
      ? and(eq(experts.userId, userId), ne(experts.id, exceptExpertId))
      : eq(experts.userId, userId);
    const [owner] = await tx
      .select({ id: experts.id })
      .from(experts)
      .where(ownerWhere)
      .limit(1);
    return { exists: true, owned: Boolean(owner) };
  }

  /** Optimistic pre-flight used before media normalization/upload. */
  async userLinkStateAnywhere(
    userId: string,
    exceptExpertId?: string,
  ): Promise<{ exists: boolean; owned: boolean }> {
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) return { exists: false, owned: false };
    const ownerWhere = exceptExpertId
      ? and(eq(experts.userId, userId), ne(experts.id, exceptExpertId))
      : eq(experts.userId, userId);
    const [owner] = await this.db
      .select({ id: experts.id })
      .from(experts)
      .where(ownerWhere)
      .limit(1);
    return { exists: true, owned: Boolean(owner) };
  }

  /** {@link slugTaken} against the pool — the optimistic pre-flight read. */
  slugTakenAnywhere(slug: string, exceptId?: string): Promise<boolean> {
    return this.slugTaken(this.db, slug, exceptId);
  }

  /**
   * Whether `slug` is held by any retained row other than `exceptId` — including
   * an editorially removed one (012-design §2.4): a removed expert permanently
   * keeps its slug, so the public URL can never later resolve to a different
   * person. Checked before the write for a naming 409; the unique index remains
   * the final race guard.
   */
  async slugTaken(
    tx: Tx | Db,
    slug: string,
    exceptId?: string,
  ): Promise<boolean> {
    const where = exceptId
      ? and(eq(experts.slug, slug), ne(experts.id, exceptId))
      : eq(experts.slug, slug);
    const [row] = await tx
      .select({ id: experts.id })
      .from(experts)
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
    patch: ExpertPatch,
  ): Promise<Expert | null> {
    const [row] = await tx
      .update(experts)
      .set({
        ...patch,
        version: sql`${experts.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(experts.id, id), eq(experts.version, expectedVersion)))
      .returning();
    return row ?? null;
  }

  /**
   * The shared admin list read (012-design §5.1) with LD-6's search: offset
   * pagination, `ILIKE '%q%'` over structured names and `slug` served by pg_trgm
   * GIN indexes, explicit status filter, retired rows excluded
   * unless asked for. The predicate is SQL, never a full-roster scan filtered in
   * application code (EARS-15).
   */
  async list(
    query: AdminTaxonomyListQuery,
  ): Promise<{ rows: Expert[]; total: number }> {
    const filters = [];
    if (query.status) {
      filters.push(eq(experts.status, query.status));
    } else if (!query.includeRetired) {
      filters.push(isNull(experts.deletedAt));
    }
    if (query.q) {
      // NFKC first: two visually identical inputs (a composed «й» and its
      // decomposed twin) must behave the same, and the stored column is NFKC
      // too, so normalizing here is what makes the comparison honest rather
      // than a lucky byte match (012-design §2.2 LD-6).
      const pattern = `%${escapeLike(query.q.normalize("NFKC"))}%`;
      filters.push(
        or(
          ilike(experts.familyName, pattern),
          ilike(experts.givenName, pattern),
          ilike(experts.patronymic, pattern),
          ilike(experts.slug, pattern),
        ),
      );
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const rows = await this.db
      .select()
      .from(experts)
      .where(where)
      // Stable total order ending in id — two rows updated in the same
      // millisecond must not swap places between pages.
      .orderBy(
        asc(experts.familyName),
        asc(experts.givenName),
        asc(experts.patronymic),
        asc(experts.id),
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await this.db
      .select({ value: count() })
      .from(experts)
      .where(where);
    return { rows, total: Number(totals?.value ?? 0) };
  }

  /**
   * Expert-owned User selector. A LEFT JOIN makes eligibility one SQL predicate:
   * no retained Expert owns the User, or the sole owner is the Expert currently
   * being edited. The retained uniqueness index is the final write-race guard.
   */
  async listEligibleUsers(query: EligibleExpertUserQuery): Promise<{
    rows: EligibleExpertUserOption[];
    total: number;
  }> {
    const filters = [
      eq(users.recordStatus, "active"),
      isNull(users.deletedAt),
      isNull(users.deactivatedAt),
      query.currentExpertId
        ? or(isNull(experts.id), eq(experts.id, query.currentExpertId))!
        : isNull(experts.id),
    ];
    if (query.q) {
      const pattern = `%${escapeLike(query.q.normalize("NFKC"))}%`;
      filters.push(
        or(
          ilike(users.displayName, pattern),
          ilike(users.email, pattern),
          ilike(users.phone, pattern),
        )!,
      );
    }
    const where = and(...filters);
    // `users_email_or_phone` guarantees this expression is non-null. Expose one
    // operator label rather than ambiguous nullable contact fields.
    const identifier = sql<string>`coalesce(${users.email}::text, ${users.phone})`;
    const selection = {
      id: users.id,
      displayName: users.displayName,
      identifier,
    };
    const rows = await this.db
      .select(selection)
      .from(users)
      .leftJoin(experts, eq(experts.userId, users.id))
      .where(where)
      .orderBy(asc(users.displayName), asc(identifier), asc(users.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const [totals] = await this.db
      .select({ value: count() })
      .from(users)
      .leftJoin(experts, eq(experts.userId, users.id))
      .where(where);
    return { rows, total: Number(totals?.value ?? 0) };
  }
}

/** Escape the LIKE wildcards so a search for `100%` is a literal search. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, ilike, isNull, ne, or, sql } from "drizzle-orm";
import type { DrizzleHandle, Project } from "@ds/db";
import { projects } from "@ds/db";
import type { AdminTaxonomyListQuery, ProjectKind } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";

// 012 EARS-1 (#1283) — Drizzle data access for the `projects` aggregate. Every
// mutating path runs through `withRequestAuditContext`, so feature 010's capture
// trigger attributes the resulting `data.projects.*` ledger rows to the acting
// admin without this layer knowing who that is.

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface ProjectInsert {
  slug: string;
  kind: ProjectKind;
  title: string;
  description: string | null;
  coverRef: string | null;
}

/** The field patch a PATCH applies. `undefined` means unchanged. */
export interface ProjectPatch {
  slug?: string;
  kind?: ProjectKind;
  title?: string;
  description?: string | null;
  /** `undefined` keeps the current reference; `null` clears it; a string replaces it. */
  coverRef?: string | null;
}

@Injectable()
export class ProjectsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /** Run `fn` in one audit-attributed transaction. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.db, fn);
  }

  async insert(tx: Tx, values: ProjectInsert): Promise<Project> {
    const [row] = await tx.insert(projects).values(values).returning();
    if (!row) throw new Error("project insert returned no row");
    return row;
  }

  async findById(id: string): Promise<Project | null> {
    const [row] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, id));
    return row ?? null;
  }

  /** Read the row FOR UPDATE inside a transaction — the PATCH concurrency boundary. */
  async lockById(tx: Tx, id: string): Promise<Project | null> {
    const [row] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .for("update");
    return row ?? null;
  }

  /** {@link slugTaken} against the pool — the optimistic pre-flight read. */
  slugTakenAnywhere(slug: string, exceptId?: string): Promise<boolean> {
    return this.slugTaken(this.db, slug, exceptId);
  }

  /**
   * Whether `slug` is held by any retained row other than `exceptId`. Checked
   * before the write so the operator gets 409 `SLUG_CONFLICT` naming the
   * conflict, rather than an opaque unique-violation; the unique index remains
   * the final race guard.
   */
  async slugTaken(tx: Tx | Db, slug: string, exceptId?: string): Promise<boolean> {
    const where = exceptId
      ? and(eq(projects.slug, slug), ne(projects.id, exceptId))
      : eq(projects.slug, slug);
    const [row] = await tx
      .select({ id: projects.id })
      .from(projects)
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
    patch: ProjectPatch,
  ): Promise<Project | null> {
    const [row] = await tx
      .update(projects)
      .set({
        ...patch,
        version: sql`${projects.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(projects.id, id), eq(projects.version, expectedVersion)))
      .returning();
    return row ?? null;
  }

  /**
   * The shared admin list read (012-design §5.1): offset pagination,
   * case-insensitive `q` over title and slug, explicit status filter, and
   * retired rows excluded unless asked for.
   */
  async list(
    query: AdminTaxonomyListQuery,
  ): Promise<{ rows: Project[]; total: number }> {
    const filters = [];
    if (query.status) {
      filters.push(eq(projects.status, query.status));
    } else if (!query.includeRetired) {
      // Default working set: everything that is not retired. Expressed as
      // `deleted_at IS NULL` so it reads off the same invariant the CHECK pins.
      filters.push(isNull(projects.deletedAt));
    }
    if (query.q) {
      const pattern = `%${escapeLike(query.q)}%`;
      filters.push(
        or(ilike(projects.title, pattern), ilike(projects.slug, pattern)),
      );
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const rows = await this.db
      .select()
      .from(projects)
      .where(where)
      // Stable total order ending in id — two rows updated in the same
      // millisecond must not swap places between pages.
      .orderBy(asc(projects.title), asc(projects.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await this.db
      .select({ value: count() })
      .from(projects)
      .where(where);
    return { rows, total: Number(totals?.value ?? 0) };
  }
}

/** Escape the LIKE wildcards so a search for `100%` is a literal search. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

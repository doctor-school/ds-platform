import { Inject, Injectable } from "@nestjs/common";
import { and, count, desc, eq, ilike, sql } from "drizzle-orm";
import type { DrizzleHandle, Material } from "@ds/db";
import { experts, materials, organisations } from "@ds/db";
import type { AdminMaterialListQuery } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import {
  type AuditedTransaction,
  withRequestAuditContext,
} from "../audit/audit-context.tx.js";

// 048 (#3512) — Drizzle access to the `materials` aggregate, shaped like the
// 012/032 repositories: every mutating path runs through
// `withRequestAuditContext`, so feature 010's capture trigger attributes the
// `data.materials.*` ledger rows to the acting administrator (EARS-8). The 012
// expert directory and the 032 organisation registry are READ here, never
// written (Lead decision 11).

type Db = DrizzleHandle["db"];
export type MaterialsTx = AuditedTransaction;

export type TaxonomyRowStatus = "draft" | "published" | "retired";

export interface MaterialExpertRow {
  id: string;
  status: TaxonomyRowStatus;
  familyName: string | null;
  givenName: string | null;
  patronymic: string | null;
}

export interface MaterialOrganisationRow {
  id: string;
  status: TaxonomyRowStatus;
  title: string;
}

export interface MaterialInsert {
  slug: string;
  kind: "news" | "column";
  title: string;
  authorLine: string;
  expertId: string | null;
  partnerOrganisationId: string | null;
  body: unknown;
}

/** Every column an edit or a lifecycle move may write. */
export interface MaterialPatch {
  slug?: string;
  kind?: "news" | "column";
  title?: string;
  authorLine?: string;
  expertId?: string | null;
  partnerOrganisationId?: string | null;
  body?: unknown;
  status?: "draft" | "published";
  /** Written by the first publish only; the DB trigger pins it thereafter. */
  firstPublishedAt?: Date;
}

export interface MaterialListRow {
  material: Material;
  expert: MaterialExpertRow | null;
}

@Injectable()
export class MaterialsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly handle: Db) {}

  db(): Db {
    return this.handle;
  }

  /** Run `fn` in one audit-attributed transaction. */
  transaction<T>(fn: (tx: MaterialsTx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.handle, fn);
  }

  /** Serialize allocation of one slug sequence. */
  async lockSlugSequence(tx: MaterialsTx, base: string): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`material:${base}`}, 0))`,
    );
  }

  async slugTaken(
    tx: MaterialsTx,
    slug: string,
    exceptId?: string,
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: materials.id })
      .from(materials)
      .where(eq(materials.slug, slug))
      .limit(1);
    return Boolean(row && row.id !== exceptId);
  }

  async insert(tx: MaterialsTx, values: MaterialInsert): Promise<Material> {
    const [row] = await tx.insert(materials).values(values).returning();
    if (!row) throw new Error("material insert returned no row");
    return row;
  }

  async findById(
    id: string,
    tx: MaterialsTx | Db = this.handle,
  ): Promise<Material | null> {
    const [row] = await tx.select().from(materials).where(eq(materials.id, id));
    return row ?? null;
  }

  /** The row FOR UPDATE — the concurrency boundary of every write. */
  async lockById(tx: MaterialsTx, id: string): Promise<Material | null> {
    const [row] = await tx
      .select()
      .from(materials)
      .where(eq(materials.id, id))
      .for("update");
    return row ?? null;
  }

  /** Apply a patch and bump `version`, guarded by the expected version. */
  async updateVersioned(
    tx: MaterialsTx,
    id: string,
    expectedVersion: number,
    patch: MaterialPatch,
  ): Promise<Material | null> {
    const [row] = await tx
      .update(materials)
      .set({
        ...patch,
        version: sql`${materials.version} + 1`,
        // The DB clock, as the insert default: the admin list orders by it, so
        // one clock must stamp every change (API and DB hosts can drift).
        updatedAt: sql`now()`,
      })
      .where(and(eq(materials.id, id), eq(materials.version, expectedVersion)))
      .returning();
    return row ?? null;
  }

  /**
   * A 012 expert, read FOR SHARE inside a write so it cannot be retired or
   * unpublished under the check (`lock`), or plainly for a projection.
   */
  async readExpert(
    tx: MaterialsTx | Db,
    id: string,
    lock = false,
  ): Promise<MaterialExpertRow | null> {
    const query = tx
      .select({
        id: experts.id,
        status: experts.status,
        familyName: experts.familyName,
        givenName: experts.givenName,
        patronymic: experts.patronymic,
      })
      .from(experts)
      .where(eq(experts.id, id));
    const [row] = lock ? await query.for("share") : await query;
    return row ?? null;
  }

  /** A 032 organisation, read FOR SHARE inside a write (`lock`). */
  async readOrganisation(
    tx: MaterialsTx | Db,
    id: string,
    lock = false,
  ): Promise<MaterialOrganisationRow | null> {
    const query = tx
      .select({
        id: organisations.id,
        status: organisations.status,
        title: organisations.title,
      })
      .from(organisations)
      .where(eq(organisations.id, id));
    const [row] = lock ? await query.for("share") : await query;
    return row ?? null;
  }

  /**
   * EARS-7 — the admin list: title search (`ILIKE`, as the 012 lists), kind and
   * status filters, most recently changed first with `id` as the tiebreak,
   * joined to the column's expert for the author and the off-site mark.
   */
  async list(
    query: AdminMaterialListQuery,
  ): Promise<{ rows: MaterialListRow[]; total: number }> {
    const filters = [];
    if (query.kind) filters.push(eq(materials.kind, query.kind));
    if (query.status) filters.push(eq(materials.status, query.status));
    if (query.q) {
      filters.push(
        ilike(materials.title, `%${escapeLike(query.q.normalize("NFKC"))}%`),
      );
    }
    const where = filters.length > 0 ? and(...filters) : undefined;
    const rows = await this.handle
      .select({
        material: materials,
        expertId: experts.id,
        expertStatus: experts.status,
        familyName: experts.familyName,
        givenName: experts.givenName,
        patronymic: experts.patronymic,
      })
      .from(materials)
      .leftJoin(experts, eq(experts.id, materials.expertId))
      .where(where)
      .orderBy(desc(materials.updatedAt), desc(materials.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const [totals] = await this.handle
      .select({ value: count() })
      .from(materials)
      .where(where);
    return {
      rows: rows.map((r) => ({
        material: r.material,
        expert:
          r.expertId && r.expertStatus
            ? {
                id: r.expertId,
                status: r.expertStatus,
                familyName: r.familyName,
                givenName: r.givenName,
                patronymic: r.patronymic,
              }
            : null,
      })),
      total: Number(totals?.value ?? 0),
    };
  }
}

/** Escape the LIKE wildcards so a search for `100%` is a literal search. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

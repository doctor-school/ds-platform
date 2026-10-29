import { Inject, Injectable } from "@nestjs/common";
import {
  and,
  asc,
  count,
  eq,
  ilike,
  inArray,
  isNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { DrizzleHandle, Organisation } from "@ds/db";
import {
  organisationRoleAssignments,
  organisationRoles,
  organisations,
} from "@ds/db";
import type { OrganisationRoleRef } from "@ds/schemas";
import type { AdminTaxonomyListQuery } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";

// 032 EARS-1, EARS-2 (#3492; 012 EARS-4, #1286) — Drizzle data access for the
// `organisations` aggregate and its `organisation_role_assignments` role set,
// shaped exactly like `ProjectsRepository` / `ExpertsRepository`: every mutating
// path runs through `withRequestAuditContext`, so feature 010's capture trigger
// attributes the resulting `data.organisations.*` ledger rows to the acting
// admin without this layer knowing who that is. An organisation's title and
// website are ordinary audited columns (012-design §6) — no masked-column
// registry entry.

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface OrganisationInsert {
  slug: string;
  title: string;
  websiteUrl: string | null;
  logoRef: string | null;
  description: string | null;
  publicNameVisible: boolean;
  publicLogoVisible: boolean;
}

/** The field patch a PATCH applies. `undefined` means unchanged. */
export interface OrganisationPatch {
  title?: string;
  websiteUrl?: string | null;
  description?: string | null;
  publicNameVisible?: boolean;
  publicLogoVisible?: boolean;
  /** `undefined` keeps the current reference; `null` clears it; a string replaces it. */
  logoRef?: string | null;
}

/** The lifecycle columns a publish/retire/restore moves (012-design §2.1). */
export interface OrganisationLifecyclePatch {
  status?: "draft" | "published" | "retired";
  deletedAt?: Date | null;
  /** Written by the FIRST publish only; never re-stamped (LD-3). */
  firstPublishedAt?: Date;
}

@Injectable()
export class OrganisationsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly handle: Db) {}

  /** The pool handle, for reads outside a transaction. */
  db(): Db {
    return this.handle;
  }

  /** Run `fn` in one audit-attributed transaction. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.handle, fn);
  }

  /** Serialize allocation of one derived retained slug sequence. */
  async lockSlugSequence(tx: Tx, base: string): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${base}, 0))`,
    );
  }

  async insert(tx: Tx, values: OrganisationInsert): Promise<Organisation> {
    const [row] = await tx.insert(organisations).values(values).returning();
    if (!row) throw new Error("partner insert returned no row");
    return row;
  }

  async findById(id: string): Promise<Organisation | null> {
    const [row] = await this.handle
      .select()
      .from(organisations)
      .where(eq(organisations.id, id));
    return row ?? null;
  }

  /** Read the row FOR UPDATE inside a transaction — the PATCH concurrency boundary. */
  async lockById(tx: Tx, id: string): Promise<Organisation | null> {
    const [row] = await tx
      .select()
      .from(organisations)
      .where(eq(organisations.id, id))
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
      .select({ id: organisations.id })
      .from(organisations)
      .where(eq(organisations.slug, slug))
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
    patch: OrganisationPatch,
  ): Promise<Organisation | null> {
    const [row] = await tx
      .update(organisations)
      .set({
        ...patch,
        version: sql`${organisations.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(organisations.id, id),
          eq(organisations.version, expectedVersion),
        ),
      )
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
    patch: OrganisationLifecyclePatch,
  ): Promise<Organisation | null> {
    const [row] = await tx
      .update(organisations)
      .set({
        ...patch,
        version: sql`${organisations.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(organisations.id, id),
          eq(organisations.version, expectedVersion),
        ),
      )
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
  // ── 032 EARS-2: the role set ───────────────────────────────────────────

  /**
   * The requested roles with their status, read FOR SHARE: role retirement
   * (EARS-4) takes the role row lock before checking holders, so a role
   * validated here cannot be retired under this transaction.
   */
  async lockRoles(
    tx: Tx | Db,
    ids: readonly string[],
  ): Promise<{ id: string; status: "active" | "retired" }[]> {
    if (ids.length === 0) return [];
    return tx
      .select({ id: organisationRoles.id, status: organisationRoles.status })
      .from(organisationRoles)
      .where(inArray(organisationRoles.id, [...ids]))
      .for("share");
  }

  /** The requested roles with their status, unlocked (optimistic pre-check). */
  async readRoles(
    tx: Tx | Db,
    ids: readonly string[],
  ): Promise<{ id: string; status: "active" | "retired" }[]> {
    if (ids.length === 0) return [];
    return tx
      .select({ id: organisationRoles.id, status: organisationRoles.status })
      .from(organisationRoles)
      .where(inArray(organisationRoles.id, [...ids]));
  }

  /** The role ids `organisationId` holds now. */
  async heldRoleIds(tx: Tx | Db, organisationId: string): Promise<string[]> {
    const rows = await tx
      .select({ roleId: organisationRoleAssignments.roleId })
      .from(organisationRoleAssignments)
      .where(eq(organisationRoleAssignments.organisationId, organisationId));
    return rows.map((r) => r.roleId);
  }

  /** Replace the set: delete the missing assignments, insert the new ones. */
  async replaceRoles(
    tx: Tx,
    organisationId: string,
    roleIds: readonly string[],
  ): Promise<void> {
    const keep = [...roleIds];
    await tx
      .delete(organisationRoleAssignments) // retained-data-ok: a role set is a membership join, replaced delete-missing + insert-new by design (032-design §Data model); each removal is a feature-010 ledger row (EARS-13)
      .where(
        keep.length > 0
          ? and(
              eq(organisationRoleAssignments.organisationId, organisationId),
              notInArray(organisationRoleAssignments.roleId, keep),
            )
          : eq(organisationRoleAssignments.organisationId, organisationId),
      );
    if (keep.length > 0) {
      await tx
        .insert(organisationRoleAssignments)
        .values(keep.map((roleId) => ({ organisationId, roleId })))
        .onConflictDoNothing();
    }
  }

  /** The held roles of each organisation, ordered by title (retired ones included). */
  async rolesFor(
    tx: Tx | Db,
    organisationIds: readonly string[],
  ): Promise<Map<string, OrganisationRoleRef[]>> {
    const out = new Map<string, OrganisationRoleRef[]>();
    if (organisationIds.length === 0) return out;
    const rows = await tx
      .select({
        organisationId: organisationRoleAssignments.organisationId,
        id: organisationRoles.id,
        slug: organisationRoles.slug,
        title: organisationRoles.title,
        status: organisationRoles.status,
      })
      .from(organisationRoleAssignments)
      .innerJoin(
        organisationRoles,
        eq(organisationRoles.id, organisationRoleAssignments.roleId),
      )
      .where(
        inArray(organisationRoleAssignments.organisationId, [
          ...organisationIds,
        ]),
      )
      .orderBy(asc(organisationRoles.title), asc(organisationRoles.id));
    for (const { organisationId, ...role } of rows) {
      const list = out.get(organisationId) ?? [];
      list.push(role);
      out.set(organisationId, list);
    }
    return out;
  }

  async list(
    query: AdminTaxonomyListQuery,
  ): Promise<{ rows: Organisation[]; total: number }> {
    const filters = [];
    if (query.status) {
      filters.push(eq(organisations.status, query.status));
    } else if (!query.includeRetired) {
      filters.push(isNull(organisations.deletedAt));
    }
    if (query.q) {
      // NFKC first: two visually identical inputs (a composed «й» and its
      // decomposed twin) must behave the same, and the stored column is NFKC
      // too, so normalizing here is what makes the comparison honest rather
      // than a lucky byte match (012-design §2.2 LD-6).
      const pattern = `%${escapeLike(query.q.normalize("NFKC"))}%`;
      filters.push(
        or(
          ilike(organisations.title, pattern),
          ilike(organisations.slug, pattern),
        ),
      );
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const rows = await this.handle
      .select()
      .from(organisations)
      .where(where)
      // Stable total order ending in id — two rows updated in the same
      // millisecond must not swap places between pages.
      .orderBy(asc(organisations.title), asc(organisations.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await this.handle
      .select({ value: count() })
      .from(organisations)
      .where(where);
    return { rows, total: Number(totals?.value ?? 0) };
  }
}

/** Escape the LIKE wildcards so a search for `100%` is a literal search. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, isNull, ne, sql } from "drizzle-orm";
import type { DrizzleHandle, OrganisationRole } from "@ds/db";
import {
  organisationRoleAssignments,
  organisationRoles,
  organisations,
} from "@ds/db";
import type { OrganisationRoleStatus } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";

// 032 EARS-3 (#3492) — Drizzle data access for the organisation-role reference
// book. Every mutating path runs through `withRequestAuditContext`, so feature
// 010's capture trigger attributes the `data.organisation_roles.*` ledger rows
// to the acting administrator (EARS-13).

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A role row with the number of draft and published organisations holding it. */
export type OrganisationRoleWithCount = OrganisationRole & {
  organisationCount: number;
};

@Injectable()
export class OrganisationRolesRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /** Run `fn` in one audit-attributed transaction. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.db, fn);
  }

  /** Serialize allocation of one derived slug sequence. */
  async lockSlugSequence(tx: Tx, base: string): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${base}, 0))`,
    );
  }

  /**
   * Serialize writers of one case-insensitive active title, so the pre-check
   * below and the partial unique index agree on the winner.
   */
  async lockTitle(tx: Tx, title: string): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`organisation-role-title:${title.toLowerCase()}`}, 0))`,
    );
  }

  /** Whether `slug` is held by any role row, retired ones included. */
  async slugTaken(tx: Tx | Db, slug: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: organisationRoles.id })
      .from(organisationRoles)
      .where(eq(organisationRoles.slug, slug))
      .limit(1);
    return Boolean(row);
  }

  /** Whether another ACTIVE role already carries `title`, case-insensitively. */
  async activeTitleTaken(
    tx: Tx | Db,
    title: string,
    exceptId?: string,
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: organisationRoles.id })
      .from(organisationRoles)
      .where(
        and(
          eq(organisationRoles.status, "active"),
          sql`lower(${organisationRoles.title}) = lower(${title})`,
          exceptId ? ne(organisationRoles.id, exceptId) : undefined,
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async insert(
    tx: Tx,
    values: { slug: string; title: string },
  ): Promise<OrganisationRole> {
    const [row] = await tx.insert(organisationRoles).values(values).returning();
    if (!row) throw new Error("organisation role insert returned no row");
    return row;
  }

  async findById(tx: Tx | Db, id: string): Promise<OrganisationRole | null> {
    const [row] = await tx
      .select()
      .from(organisationRoles)
      .where(eq(organisationRoles.id, id));
    return row ?? null;
  }

  async lockById(tx: Tx, id: string): Promise<OrganisationRole | null> {
    const [row] = await tx
      .select()
      .from(organisationRoles)
      .where(eq(organisationRoles.id, id))
      .for("update");
    return row ?? null;
  }

  /** Rename and bump `version`, guarded by the caller's expected version. */
  async renameVersioned(
    tx: Tx,
    id: string,
    expectedVersion: number,
    title: string,
  ): Promise<OrganisationRole | null> {
    const [row] = await tx
      .update(organisationRoles)
      .set({
        title,
        version: sql`${organisationRoles.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(organisationRoles.id, id),
          eq(organisationRoles.version, expectedVersion),
        ),
      )
      .returning();
    return row ?? null;
  }

  /** Draft and published (not retired) organisations holding `roleId`. */
  async holderCount(tx: Tx | Db, roleId: string): Promise<number> {
    const [row] = await tx
      .select({ value: count() })
      .from(organisationRoleAssignments)
      .innerJoin(
        organisations,
        eq(organisations.id, organisationRoleAssignments.organisationId),
      )
      .where(
        and(
          eq(organisationRoleAssignments.roleId, roleId),
          isNull(organisations.deletedAt),
        ),
      );
    return Number(row?.value ?? 0);
  }

  /** The whole book (a small one), ordered by title, with holder counts. */
  async list(
    status: OrganisationRoleStatus | undefined,
  ): Promise<OrganisationRoleWithCount[]> {
    const holders = this.db
      .select({
        roleId: organisationRoleAssignments.roleId,
        n: count().as("n"),
      })
      .from(organisationRoleAssignments)
      .innerJoin(
        organisations,
        eq(organisations.id, organisationRoleAssignments.organisationId),
      )
      .where(isNull(organisations.deletedAt))
      .groupBy(organisationRoleAssignments.roleId)
      .as("holders");
    const rows = await this.db
      .select({
        role: organisationRoles,
        n: holders.n,
      })
      .from(organisationRoles)
      .leftJoin(holders, eq(holders.roleId, organisationRoles.id))
      .where(status ? eq(organisationRoles.status, status) : undefined)
      .orderBy(asc(organisationRoles.title), asc(organisationRoles.id));
    return rows.map(({ role, n }) => ({
      ...role,
      organisationCount: Number(n ?? 0),
    }));
  }
}

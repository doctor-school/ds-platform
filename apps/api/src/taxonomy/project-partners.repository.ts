import { Inject, Injectable } from "@nestjs/common";
import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type {
  DrizzleHandle,
  Organisation,
  Project,
  ProjectOrganisation,
} from "@ds/db";
import {
  organisations,
  projectOrganisations,
  projects,
  SEED_ORGANISATION_ROLES,
} from "@ds/db";
import type { ProjectPartnerAdminListQuery } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";
import { withRelationConflictMapping } from "./taxonomy.errors.js";

// 012 EARS-10 (#1292) — Drizzle data access for the `project_organisations` join
// (the 012 `project_partners` table, renamed by 032 migration 0054).
//
// The write protocol here is deliberately SHORTER than the `project_experts`
// one, and the difference is a property of the invariant rather than a shortcut:
// the at-most-one-active-primary rule is a statement about ONE project's rows
// only. There is no cross-table lower bound to preserve (a published project
// with no primary partner is legal, §5.2), so no partner lifecycle can break it
// and no partner row needs locking. Locking the parent project and then its
// relation set is the whole argument.
//
// The lock order is nevertheless the same SHAPE as §3.2's — project first, its
// relation rows second, both ascending stable id — so a transaction that ever
// needs both joins cannot deadlock against the expert one.

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** The lifecycle facts a primary-flag decision needs about its project endpoint. */
export interface ProjectLifecycle {
  id: string;
  status: "draft" | "published" | "retired";
  deletedAt: Date | null;
}

/** The lifecycle facts a link decision needs about its partner endpoint. */
export interface PartnerLifecycle {
  id: string;
  status: "draft" | "published" | "retired";
  deletedAt: Date | null;
}

/** One relation plus both endpoints' display forms — the admin projection input. */
export interface ProjectPartnerRow {
  relation: ProjectOrganisation;
  project: { id: string; slug: string; title: string };
  partner: { id: string; slug: string; title: string };
}

/** The field patch a write applies. `undefined` means unchanged. */
export interface ProjectPartnerPatch {
  isPrimary?: boolean;
  status?: "active" | "retired";
  deletedAt?: Date | null;
}

/** One §5.2 partner item of a project, before its logo URL is signed. */
export interface PublicProjectPartnerRow {
  isPrimary: boolean;
  partner: Organisation;
}

/** One §5.2 project item of a partner, before its summary is built. */
export interface PublicPartnerProjectRow {
  isPrimary: boolean;
  project: Project;
}

@Injectable()
export class ProjectPartnersRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /** Run `fn` in one audit-attributed transaction (feature 010 attribution). */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.db, fn);
  }

  /** Step 1 of the lock order: the parent project(s), ascending stable id. */
  async lockProjects(tx: Tx, ids: string[]): Promise<ProjectLifecycle[]> {
    const ordered = [...new Set(ids)].sort();
    if (ordered.length === 0) return [];
    return tx
      .select({
        id: projects.id,
        status: projects.status,
        deletedAt: projects.deletedAt,
      })
      .from(projects)
      .where(inArray(projects.id, ordered))
      .orderBy(asc(projects.id))
      .for("update");
  }

  /**
   * Step 2: every relation of the project, FOR UPDATE, ascending relation id.
   * Taken as a SET rather than row-by-row for the same reason the curator seat
   * is: "at most one primary" is a statement about the whole set, so two writes
   * that each locked only their own row could both believe they left one.
   */
  async lockRelationsOfProject(
    tx: Tx,
    projectId: string,
  ): Promise<ProjectOrganisation[]> {
    return tx
      .select()
      .from(projectOrganisations)
      .where(eq(projectOrganisations.projectId, projectId))
      .orderBy(asc(projectOrganisations.id))
      .for("update");
  }

  /**
   * The lifecycle of the partner endpoint, WITHOUT locking: a partner's own
   * lifecycle cannot violate this join's invariant (there is no lower bound), so
   * locking it would widen the lock set for nothing. It is read only to refuse
   * linking a soft-deleted row.
   */
  async partnerLifecycle(tx: Tx, id: string): Promise<PartnerLifecycle | null> {
    const [row] = await tx
      .select({
        id: organisations.id,
        status: organisations.status,
        deletedAt: organisations.deletedAt,
      })
      .from(organisations)
      .where(eq(organisations.id, id));
    return row ?? null;
  }

  async insert(
    tx: Tx,
    values: { projectId: string; partnerId: string; isPrimary: boolean },
  ): Promise<ProjectOrganisation> {
    return withRelationConflictMapping(async () => {
      const [row] = await tx
        .insert(projectOrganisations)
        .values({
          projectId: values.projectId,
          organisationId: values.partnerId,
          // 030 EARS-17: until the «Организации» panel offers a per-project
          // role (030 EARS-4), a new link takes the investor role every
          // absorbed link received from migration 0055.
          roleId: SEED_ORGANISATION_ROLES.investor.id,
          isPrimary: values.isPrimary,
        })
        .returning();
      if (!row) throw new Error("project_partner insert returned no row");
      return row;
    });
  }

  async findById(id: string): Promise<ProjectOrganisation | null> {
    const [row] = await this.db
      .select()
      .from(projectOrganisations)
      .where(eq(projectOrganisations.id, id));
    return row ?? null;
  }

  /**
   * Whether the `(projectId, partnerId)` pair is already held by a RETAINED row
   * other than `exceptId` — a retired relation included (012-design §2.1): a
   * retired relation is RESTORED, never reinserted.
   */
  async pairTaken(
    tx: Tx,
    projectId: string,
    partnerId: string,
    exceptId?: string,
  ): Promise<boolean> {
    const base = [
      eq(projectOrganisations.projectId, projectId),
      eq(projectOrganisations.organisationId, partnerId),
    ];
    if (exceptId) base.push(ne(projectOrganisations.id, exceptId));
    const [row] = await tx
      .select({ id: projectOrganisations.id })
      .from(projectOrganisations)
      .where(and(...base))
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
    patch: ProjectPartnerPatch,
  ): Promise<ProjectOrganisation | null> {
    // Wrapped for the same §6 reason as `insert`: a patch that raises
    // `isPrimary` races the project's partial primary-slot index, and the
    // pre-check cannot serialize two callers claiming the slot at once.
    return withRelationConflictMapping(async () => {
      const [row] = await tx
        .update(projectOrganisations)
        .set({
          ...patch,
          version: sql`${projectOrganisations.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(projectOrganisations.id, id),
            eq(projectOrganisations.version, expectedVersion),
          ),
        )
        .returning();
      return row ?? null;
    });
  }

  /** Hydrate one relation with both endpoints' display forms (admin detail). */
  async hydrate(tx: Tx | Db, id: string): Promise<ProjectPartnerRow | null> {
    const [row] = await this.selectRows(tx).where(
      eq(projectOrganisations.id, id),
    );
    return row ? shape(row) : null;
  }

  /** {@link hydrate} against the pool — a read needs no transaction, no lock. */
  hydratePooled(id: string): Promise<ProjectPartnerRow | null> {
    return this.hydrate(this.db, id);
  }

  /**
   * The join admin list (012-design §5.1): offset pagination, either endpoint
   * scopes it, explicit status, retired rows excluded unless asked for. The
   * total order ends in the stable relation id — two relations written in the
   * same millisecond must not swap places between pages.
   */
  async list(
    query: ProjectPartnerAdminListQuery,
  ): Promise<{ rows: ProjectPartnerRow[]; total: number }> {
    const filters = [];
    if (query.projectId) {
      filters.push(eq(projectOrganisations.projectId, query.projectId));
    }
    if (query.partnerId) {
      filters.push(eq(projectOrganisations.organisationId, query.partnerId));
    }
    if (query.isPrimary !== undefined) {
      filters.push(eq(projectOrganisations.isPrimary, query.isPrimary));
    }
    if (query.status) {
      filters.push(eq(projectOrganisations.status, query.status));
    } else if (!query.includeRetired) {
      filters.push(isNull(projectOrganisations.deletedAt));
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const rows = await this.selectRows(this.db)
      .where(where)
      .orderBy(asc(projects.title), asc(projectOrganisations.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await this.db
      .select({ value: count() })
      .from(projectOrganisations)
      .where(where);

    return { rows: rows.map(shape), total: Number(totals?.value ?? 0) };
  }

  /** Resolve a project by canonical UUID or slug; eligibility is the caller's. */
  async findPublicProject(key: {
    id?: string;
    slug?: string;
  }): Promise<Project | null> {
    const where = key.id
      ? eq(projects.id, key.id)
      : eq(projects.slug, key.slug!);
    const [row] = await this.db.select().from(projects).where(where);
    return row ?? null;
  }

  /** Resolve a partner by canonical UUID or slug; eligibility is the caller's. */
  async findPublicPartner(key: {
    id?: string;
    slug?: string;
  }): Promise<Organisation | null> {
    const where = key.id
      ? eq(organisations.id, key.id)
      : eq(organisations.slug, key.slug!);
    const [row] = await this.db.select().from(organisations).where(where);
    return row ?? null;
  }

  /**
   * §5.2 — the publicly eligible partners of one project, keyset-paginated on
   * `(title, id)`. Only ACTIVE relations to PUBLISHED, non-retired partners are
   * traversed. The order is alphabetical rather than "primary first": the
   * primary is identified by its own `isPrimary` field on every item, so the
   * client can hoist it without the server making the page order depend on a
   * flag that a later write can move.
   */
  async listPartnersForProject(
    projectId: string,
    limit: number,
    after: { title: string; id: string } | null,
  ): Promise<PublicProjectPartnerRow[]> {
    const filters = [
      eq(projectOrganisations.projectId, projectId),
      eq(projectOrganisations.status, "active"),
      isNull(projectOrganisations.deletedAt),
      eq(organisations.status, "published"),
      isNull(organisations.deletedAt),
    ];
    if (after) {
      filters.push(
        or(
          gt(organisations.title, after.title),
          and(
            eq(organisations.title, after.title),
            gt(organisations.id, after.id),
          ),
        )!,
      );
    }
    const rows = await this.db
      .select({
        isPrimary: projectOrganisations.isPrimary,
        partner: organisations,
      })
      .from(projectOrganisations)
      .innerJoin(
        organisations,
        eq(organisations.id, projectOrganisations.organisationId),
      )
      .where(and(...filters))
      .orderBy(asc(organisations.title), asc(organisations.id))
      .limit(limit);
    return rows.map((row) => ({
      isPrimary: row.isPrimary,
      partner: row.partner,
    }));
  }

  /**
   * §5.2 — the published projects one partner sponsors, keyset-paginated on
   * `(title, id)`: the reverse traversal reads alphabetically, the same order
   * every sibling project traversal chose.
   */
  async listProjectsForPartner(
    partnerId: string,
    limit: number,
    after: { title: string; id: string } | null,
  ): Promise<PublicPartnerProjectRow[]> {
    const filters = [
      eq(projectOrganisations.organisationId, partnerId),
      eq(projectOrganisations.status, "active"),
      isNull(projectOrganisations.deletedAt),
      eq(projects.status, "published"),
      isNull(projects.deletedAt),
    ];
    if (after) {
      filters.push(
        or(
          gt(projects.title, after.title),
          and(eq(projects.title, after.title), gt(projects.id, after.id)),
        )!,
      );
    }
    const rows = await this.db
      .select({ isPrimary: projectOrganisations.isPrimary, project: projects })
      .from(projectOrganisations)
      .innerJoin(projects, eq(projects.id, projectOrganisations.projectId))
      .where(and(...filters))
      .orderBy(asc(projects.title), asc(projects.id))
      .limit(limit);
    return rows.map((row) => ({
      isPrimary: row.isPrimary,
      project: row.project,
    }));
  }

  /** The one hydrated projection both the detail and the list read through. */
  private selectRows(handle: Tx | Db) {
    return handle
      .select({
        relation: projectOrganisations,
        projectId: projects.id,
        projectSlug: projects.slug,
        projectTitle: projects.title,
        partnerId: organisations.id,
        partnerSlug: organisations.slug,
        partnerTitle: organisations.title,
      })
      .from(projectOrganisations)
      .innerJoin(projects, eq(projects.id, projectOrganisations.projectId))
      .innerJoin(
        organisations,
        eq(organisations.id, projectOrganisations.organisationId),
      );
  }
}

function shape(row: {
  relation: ProjectOrganisation;
  projectId: string;
  projectSlug: string;
  projectTitle: string;
  partnerId: string;
  partnerSlug: string;
  partnerTitle: string;
}): ProjectPartnerRow {
  return {
    relation: row.relation,
    project: {
      id: row.projectId,
      slug: row.projectSlug,
      title: row.projectTitle,
    },
    partner: {
      id: row.partnerId,
      slug: row.partnerSlug,
      title: row.partnerTitle,
    },
  };
}

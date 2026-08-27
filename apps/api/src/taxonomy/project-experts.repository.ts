import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { DrizzleHandle, Expert, Project, ProjectExpert } from "@ds/db";
import { experts, projectExperts, projects } from "@ds/db";
import type { ProjectExpertAdminListQuery } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";

// 012 EARS-9 (#1291) — Drizzle data access for the `project_experts` join.
//
// The lock helpers below are the physical half of the 012-design §3.2 write
// protocol, and their ORDER is the correctness argument rather than a style
// choice:
//
//   affected experts (ascending stable id)
//     → affected projects (ascending stable id)
//       → the `project_experts` rows
//
// EVERY writer of the curator invariant takes that order — the create, the
// PATCH, both transitions, `ReplaceProjectCurator`, and the expert-lifecycle
// transactions that can make a curator ineligible. That is what reduces the
// interleavings to two safe ones ("relation commits first, lifecycle
// revalidates" / "lifecycle commits first, relation revalidates") instead of a
// deadlock, and it is also what makes the demote-first ordering inside
// `ReplaceProjectCurator` sufficient rather than merely usual.
//
// Note the difference from `event-experts.repository.ts`: there the second lock
// is the parent EVENT, here it is the parent PROJECT. The two orders never
// interleave against each other because no single transaction locks both an
// event and a project through this join.

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** The lifecycle facts a curator decision needs about its expert endpoint. */
export interface ExpertLifecycle {
  id: string;
  status: "draft" | "published" | "retired";
  deletedAt: Date | null;
  contentRemovedAt: Date | null;
}

/** The lifecycle facts a curator decision needs about its project endpoint. */
export interface ProjectLifecycle {
  id: string;
  status: "draft" | "published" | "retired";
  deletedAt: Date | null;
}

/** One relation plus both endpoints' display forms — the admin projection input. */
export interface ProjectExpertRow {
  relation: ProjectExpert;
  project: { id: string; slug: string; title: string };
  expert: { id: string; slug: string; name: string | null };
}

/** The field patch a write applies. `undefined` means unchanged. */
export interface ProjectExpertPatch {
  role?: "curator" | "member";
  status?: "active" | "retired";
  deletedAt?: Date | null;
}

/** One §5.2 expert item of a project, before its photo URL is signed. */
export interface PublicProjectExpertRow {
  role: "curator" | "member";
  expert: Expert;
}

/** One §5.2 project item of an expert, before its summary is built. */
export interface PublicExpertProjectRow {
  role: "curator" | "member";
  project: Project;
}

@Injectable()
export class ProjectExpertsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /** Run `fn` in one audit-attributed transaction (feature 010 attribution). */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.db, fn);
  }

  /**
   * Step 1 of the §3.2 lock order: every affected expert row, ASCENDING by
   * stable id. `ids` is de-duplicated and sorted HERE rather than by the caller
   * so no call site can establish a second order — `ReplaceProjectCurator`
   * passes two ids and relies on exactly that.
   *
   * `inArray` rather than a hand-written `= ANY(...)` fragment: inside a `sql`
   * template drizzle binds a JS array as one scalar parameter per element, so
   * Postgres receives a bare uuid where it expects an array literal (22P02).
   */
  async lockExperts(tx: Tx, ids: string[]): Promise<ExpertLifecycle[]> {
    const ordered = [...new Set(ids)].sort();
    if (ordered.length === 0) return [];
    return tx
      .select({
        id: experts.id,
        status: experts.status,
        deletedAt: experts.deletedAt,
        contentRemovedAt: experts.contentRemovedAt,
      })
      .from(experts)
      .where(inArray(experts.id, ordered))
      .orderBy(asc(experts.id))
      .for("update");
  }

  /** Step 2 of the §3.2 lock order: the parent project(s), ascending stable id. */
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
   * Step 3 of the §3.2 lock order: every relation of the project, FOR UPDATE and
   * in ascending relation id. Taken as a set rather than row-by-row because the
   * curator invariant is a statement about the whole set — a demote and a
   * promote that locked only their own rows could both believe they left exactly
   * one curator behind.
   */
  async lockRelationsOfProject(
    tx: Tx,
    projectId: string,
  ): Promise<ProjectExpert[]> {
    return tx
      .select()
      .from(projectExperts)
      .where(eq(projectExperts.projectId, projectId))
      .orderBy(asc(projectExperts.id))
      .for("update");
  }

  /**
   * The lifecycle of every expert referenced by `ids`, WITHOUT locking — used to
   * classify the OTHER relations of the same project once their rows are pinned
   * by the relation locks. Those experts are not being mutated, so locking them
   * would widen the lock set past §3.2's "affected experts".
   */
  async expertLifecycles(tx: Tx, ids: string[]): Promise<ExpertLifecycle[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    return tx
      .select({
        id: experts.id,
        status: experts.status,
        deletedAt: experts.deletedAt,
        contentRemovedAt: experts.contentRemovedAt,
      })
      .from(experts)
      .where(inArray(experts.id, unique));
  }

  async insert(
    tx: Tx,
    values: { projectId: string; expertId: string; role: "curator" | "member" },
  ): Promise<ProjectExpert> {
    const [row] = await tx.insert(projectExperts).values(values).returning();
    if (!row) throw new Error("project_expert insert returned no row");
    return row;
  }

  async findById(id: string): Promise<ProjectExpert | null> {
    const [row] = await this.db
      .select()
      .from(projectExperts)
      .where(eq(projectExperts.id, id));
    return row ?? null;
  }

  /**
   * Whether the `(projectId, expertId)` pair is already held by a RETAINED row
   * other than `exceptId` — a retired relation included (012-design §2.1): a
   * retired relation is RESTORED, never reinserted.
   */
  async pairTaken(
    tx: Tx,
    projectId: string,
    expertId: string,
    exceptId?: string,
  ): Promise<boolean> {
    const base = [
      eq(projectExperts.projectId, projectId),
      eq(projectExperts.expertId, expertId),
    ];
    if (exceptId) base.push(ne(projectExperts.id, exceptId));
    const [row] = await tx
      .select({ id: projectExperts.id })
      .from(projectExperts)
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
    patch: ProjectExpertPatch,
  ): Promise<ProjectExpert | null> {
    const [row] = await tx
      .update(projectExperts)
      .set({
        ...patch,
        version: sql`${projectExperts.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(projectExperts.id, id),
          eq(projectExperts.version, expectedVersion),
        ),
      )
      .returning();
    return row ?? null;
  }

  /**
   * Bump the PROJECT's own version. `ReplaceProjectCurator` carries the
   * project's `If-Match`, so the project row is the concurrency token the
   * command asserted against and it must move when the command succeeds —
   * otherwise a second replace holding the same stale ETag would still validate.
   */
  async bumpProjectVersion(
    tx: Tx,
    projectId: string,
    expectedVersion: number,
  ): Promise<{ version: number } | null> {
    const [row] = await tx
      .update(projects)
      .set({
        version: sql`${projects.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(eq(projects.id, projectId), eq(projects.version, expectedVersion)),
      )
      .returning({ version: projects.version });
    return row ?? null;
  }

  /** The project's current version, read outside any lock — a seed, never a decision. */
  async projectVersion(id: string): Promise<number | null> {
    const [row] = await this.db
      .select({ version: projects.version })
      .from(projects)
      .where(eq(projects.id, id));
    return row?.version ?? null;
  }

  /** Hydrate one relation with both endpoints' display forms (admin detail). */
  async hydrate(tx: Tx | Db, id: string): Promise<ProjectExpertRow | null> {
    const [row] = await this.selectRows(tx).where(eq(projectExperts.id, id));
    return row ? shape(row) : null;
  }

  /** {@link hydrate} against the pool — a read needs no transaction, no lock. */
  hydratePooled(id: string): Promise<ProjectExpertRow | null> {
    return this.hydrate(this.db, id);
  }

  /**
   * Every relation of the project WITHOUT locking — the optimistic seed read
   * `ReplaceProjectCurator` uses to learn which incumbent expert to add to its
   * lock set. Nothing is decided on it: the transaction re-reads the same set
   * FOR UPDATE and refuses if the seat moved in between.
   */
  relationsOfProject(projectId: string): Promise<ProjectExpert[]> {
    return this.db
      .select()
      .from(projectExperts)
      .where(eq(projectExperts.projectId, projectId))
      .orderBy(asc(projectExperts.id));
  }

  /**
   * The join admin list (012-design §5.1): offset pagination, either endpoint
   * scopes it, explicit status, retired rows excluded unless asked for. The
   * total order ends in the stable relation id — two relations written in the
   * same millisecond must not swap places between pages.
   */
  async list(
    query: ProjectExpertAdminListQuery,
  ): Promise<{ rows: ProjectExpertRow[]; total: number }> {
    const filters = [];
    if (query.projectId) {
      filters.push(eq(projectExperts.projectId, query.projectId));
    }
    if (query.expertId) {
      filters.push(eq(projectExperts.expertId, query.expertId));
    }
    if (query.role) filters.push(eq(projectExperts.role, query.role));
    if (query.status) {
      filters.push(eq(projectExperts.status, query.status));
    } else if (!query.includeRetired) {
      filters.push(isNull(projectExperts.deletedAt));
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const rows = await this.selectRows(this.db)
      .where(where)
      .orderBy(asc(projects.title), asc(projectExperts.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await this.db
      .select({ value: count() })
      .from(projectExperts)
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

  /** Resolve an expert by canonical UUID or slug; eligibility is the caller's. */
  async findPublicExpert(key: {
    id?: string;
    slug?: string;
  }): Promise<Expert | null> {
    const where = key.id ? eq(experts.id, key.id) : eq(experts.slug, key.slug!);
    const [row] = await this.db.select().from(experts).where(where);
    return row ?? null;
  }

  /**
   * §5.2 — the publicly eligible experts of one project, keyset-paginated on
   * `(name, id)`. Only ACTIVE relations to PUBLISHED, non-retired, non-removed
   * experts are traversed: an editorially removed expert (§2.4) has no name to
   * render, so it is excluded here rather than emitted as an unlabelled item.
   */
  async listExpertsForProject(
    projectId: string,
    limit: number,
    after: { name: string; id: string } | null,
  ): Promise<PublicProjectExpertRow[]> {
    const filters = [
      eq(projectExperts.projectId, projectId),
      eq(projectExperts.status, "active"),
      isNull(projectExperts.deletedAt),
      eq(experts.status, "published"),
      isNull(experts.deletedAt),
      isNull(experts.contentRemovedAt),
    ];
    if (after) {
      filters.push(
        or(
          gt(experts.name, after.name),
          and(eq(experts.name, after.name), gt(experts.id, after.id)),
        )!,
      );
    }
    const rows = await this.db
      .select({ role: projectExperts.role, expert: experts })
      .from(projectExperts)
      .innerJoin(experts, eq(experts.id, projectExperts.expertId))
      .where(and(...filters))
      .orderBy(asc(experts.name), asc(experts.id))
      .limit(limit);
    return rows.map((row) => ({ role: row.role, expert: row.expert }));
  }

  /**
   * §5.2 — the published projects one expert works on, keyset-paginated on
   * `(title, id)`: the reverse traversal reads alphabetically, the same order
   * the sibling `/events/:key/projects` chose.
   */
  async listProjectsForExpert(
    expertId: string,
    limit: number,
    after: { title: string; id: string } | null,
  ): Promise<PublicExpertProjectRow[]> {
    const filters = [
      eq(projectExperts.expertId, expertId),
      eq(projectExperts.status, "active"),
      isNull(projectExperts.deletedAt),
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
      .select({ role: projectExperts.role, project: projects })
      .from(projectExperts)
      .innerJoin(projects, eq(projects.id, projectExperts.projectId))
      .where(and(...filters))
      .orderBy(asc(projects.title), asc(projects.id))
      .limit(limit);
    return rows.map((row) => ({ role: row.role, project: row.project }));
  }

  /** The one hydrated projection both the detail and the list read through. */
  private selectRows(handle: Tx | Db) {
    return handle
      .select({
        relation: projectExperts,
        projectId: projects.id,
        projectSlug: projects.slug,
        projectTitle: projects.title,
        expertId: experts.id,
        expertSlug: experts.slug,
        expertName: experts.name,
      })
      .from(projectExperts)
      .innerJoin(projects, eq(projects.id, projectExperts.projectId))
      .innerJoin(experts, eq(experts.id, projectExperts.expertId));
  }
}

function shape(row: {
  relation: ProjectExpert;
  projectId: string;
  projectSlug: string;
  projectTitle: string;
  expertId: string;
  expertSlug: string;
  expertName: string | null;
}): ProjectExpertRow {
  return {
    relation: row.relation,
    project: {
      id: row.projectId,
      slug: row.projectSlug,
      title: row.projectTitle,
    },
    expert: {
      id: row.expertId,
      slug: row.expertSlug,
      name: row.expertName,
    },
  };
}

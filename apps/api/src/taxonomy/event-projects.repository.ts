import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import type { DrizzleHandle, Event, EventProject, Project } from "@ds/db";
import { eventProjects, events, projects } from "@ds/db";
import type { EventProjectAdminListQuery } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";

// 012 EARS-6 (#1288) — Drizzle data access for the `event_projects` join, the
// first relationship aggregate of the feature. Same posture as the entity
// repositories: every mutating path opens its transaction through
// `withRequestAuditContext`, so feature 010's capture trigger attributes the
// resulting `data.event_projects.*` ledger rows to the acting admin without
// this layer knowing who that is.
//
// A relationship row holds NO editorial content — only its two endpoint ids and
// its own lifecycle — so nothing here is a masked column. What this repository
// does own that an entity one does not is the pair of §5.2 traversals, and the
// §3.1 impact discovery read: the set of rows a retire/restore would change the
// public visibility of.

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * The publish-visible event states (§5.2). `draft` is not public at all, and
 * `archived` is deliberately excluded from a traversal LISTING: an archived
 * direct link still resolves (004 EARS-5) to an archived-notice body, but
 * listing it as one of a project's broadcasts would advertise a page whose
 * content has been withdrawn.
 */
export const PUBLIC_EVENT_STATES = ["published", "live", "ended"] as const;

/** One relationship joined to both endpoints' display forms (§5.1, §3.1). */
export interface EventProjectRow {
  relation: EventProject;
  event: Pick<Event, "id" | "slug" | "title" | "state" | "recordStatus">;
  project: Pick<Project, "id" | "slug" | "title" | "status">;
}

/** The lifecycle patch a retire/restore applies. */
export interface RelationshipLifecyclePatch {
  status: "active" | "retired";
  deletedAt: Date | null;
}

@Injectable()
export class EventProjectsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /** Run `fn` in one audit-attributed transaction. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.db, fn);
  }

  /**
   * The §3.1 confirmation boundary: `SERIALIZABLE`, so a phantom relation
   * inserted by a concurrent transaction that overlaps this one cannot slip
   * past the fingerprint recheck. The isolation level is declared as the
   * transaction OPENS (see `AuditTransactionConfig`) — the audit GUCs are
   * ordinary queries, and PostgreSQL refuses to change isolation after the
   * first one.
   */
  serializableTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.db, fn, {
      isolationLevel: "serializable",
    });
  }

  async insert(
    tx: Tx,
    values: { eventId: string; projectId: string },
  ): Promise<EventProject> {
    const [row] = await tx.insert(eventProjects).values(values).returning();
    if (!row) throw new Error("event_projects insert returned no row");
    return row;
  }

  async findById(id: string): Promise<EventProject | null> {
    const [row] = await this.db
      .select()
      .from(eventProjects)
      .where(eq(eventProjects.id, id));
    return row ?? null;
  }

  /**
   * Read the relation FOR UPDATE together with both endpoints, in the LD-2/LD-4
   * canonical lock order §3.1 requires of a relation command: `events` before
   * `projects` before the join row, never target-first. A relation command that
   * locked its own row first and then reached for an endpoint would invert the
   * order an entity command uses and deadlock against it under load.
   */
  async lockForTransition(tx: Tx, id: string): Promise<EventProjectRow | null> {
    const [existing] = await tx
      .select()
      .from(eventProjects)
      .where(eq(eventProjects.id, id));
    if (!existing) return null;

    await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, existing.eventId))
      .for("update");
    await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, existing.projectId))
      .for("update");

    const [locked] = await tx
      .select()
      .from(eventProjects)
      .where(eq(eventProjects.id, id))
      .for("update");
    if (!locked) return null;
    return this.hydrate(tx, locked);
  }

  /** Join one relation row to both endpoints' display forms. */
  async hydrate(tx: Tx | Db, relation: EventProject): Promise<EventProjectRow> {
    const [row] = await tx
      .select({
        eventId: events.id,
        eventSlug: events.slug,
        eventTitle: events.title,
        eventState: events.state,
        eventRecordStatus: events.recordStatus,
        projectId: projects.id,
        projectSlug: projects.slug,
        projectTitle: projects.title,
        projectStatus: projects.status,
      })
      .from(events)
      .innerJoin(projects, eq(projects.id, relation.projectId))
      .where(eq(events.id, relation.eventId));
    if (!row) {
      // Both FKs are RESTRICT and nothing in 012 is physically deleted, so an
      // endpoint cannot vanish under a relation. Reaching here means the
      // database no longer satisfies its own constraints.
      throw new Error("event_projects row has an unresolvable endpoint");
    }
    return {
      relation,
      event: {
        id: row.eventId,
        slug: row.eventSlug,
        title: row.eventTitle,
        state: row.eventState,
        recordStatus: row.eventRecordStatus,
      },
      project: {
        id: row.projectId,
        slug: row.projectSlug,
        title: row.projectTitle,
        status: row.projectStatus,
      },
    };
  }

  async detailById(id: string): Promise<EventProjectRow | null> {
    const relation = await this.findById(id);
    if (!relation) return null;
    return this.hydrate(this.db, relation);
  }

  /**
   * The logical pair, ACTIVE OR RETIRED (`event_projects_pair_key` spans both).
   * A retired pair is what turns a duplicate create into «restore that relation
   * instead», rather than a second row for one relationship.
   */
  async findPair(
    tx: Tx | Db,
    eventId: string,
    projectId: string,
  ): Promise<EventProject | null> {
    const [row] = await tx
      .select()
      .from(eventProjects)
      .where(
        and(
          eq(eventProjects.eventId, eventId),
          eq(eventProjects.projectId, projectId),
        ),
      );
    return row ?? null;
  }

  async findEvent(tx: Tx | Db, id: string): Promise<Event | null> {
    const [row] = await tx.select().from(events).where(eq(events.id, id));
    return row ?? null;
  }

  async findProject(tx: Tx | Db, id: string): Promise<Project | null> {
    const [row] = await tx.select().from(projects).where(eq(projects.id, id));
    return row ?? null;
  }

  /**
   * Move the relation's lifecycle and bump `version` in one statement, guarded
   * by the caller's expected version. Zero rows ⇒ the row moved under the
   * caller. The row's IDENTITY never changes: a restore is this UPDATE, never
   * an INSERT (012-design §2.1).
   */
  async transitionVersioned(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: RelationshipLifecyclePatch,
  ): Promise<EventProject | null> {
    const [row] = await tx
      .update(eventProjects)
      .set({
        status: patch.status,
        deletedAt: patch.deletedAt,
        version: sql`${eventProjects.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(eq(eventProjects.id, id), eq(eventProjects.version, expectedVersion)),
      )
      .returning();
    return row ?? null;
  }

  /**
   * §3.1 impact discovery — every relation incident to EITHER endpoint of the
   * target, retired ones included, plus both endpoints themselves.
   *
   * Scoping to «shares an endpoint with the target» is what the fingerprint
   * needs to be honest: those are exactly the rows whose presence decides what
   * either endpoint's public traversal lists after the transition. Retired
   * relations are in the set deliberately — one restored between preview and
   * confirmation changes the result the operator was shown, even though the
   * target itself did not move.
   */
  /** {@link discoverIncident} against the pool — the preview's optimistic read. */
  discoverIncidentAnywhere(
    eventId: string,
    projectId: string,
  ): Promise<EventProjectRow[]> {
    return this.discoverIncident(this.db, eventId, projectId);
  }

  async discoverIncident(
    tx: Tx | Db,
    eventId: string,
    projectId: string,
  ): Promise<EventProjectRow[]> {
    const rows = await tx
      .select({
        relation: eventProjects,
        eventId: events.id,
        eventSlug: events.slug,
        eventTitle: events.title,
        eventState: events.state,
        eventRecordStatus: events.recordStatus,
        projectId: projects.id,
        projectSlug: projects.slug,
        projectTitle: projects.title,
        projectStatus: projects.status,
      })
      .from(eventProjects)
      .innerJoin(events, eq(events.id, eventProjects.eventId))
      .innerJoin(projects, eq(projects.id, eventProjects.projectId))
      .where(
        or(
          eq(eventProjects.eventId, eventId),
          eq(eventProjects.projectId, projectId),
        ),
      )
      .orderBy(asc(eventProjects.id));

    return rows.map((row) => ({
      relation: row.relation,
      event: {
        id: row.eventId,
        slug: row.eventSlug,
        title: row.eventTitle,
        state: row.eventState,
        recordStatus: row.eventRecordStatus,
      },
      project: {
        id: row.projectId,
        slug: row.projectSlug,
        title: row.projectTitle,
        status: row.projectStatus,
      },
    }));
  }

  /** The filtered admin list (§5.1): offset pagination, either endpoint scopes it. */
  async list(
    query: EventProjectAdminListQuery,
  ): Promise<{ rows: EventProjectRow[]; total: number }> {
    const filters = [];
    if (query.eventId) filters.push(eq(eventProjects.eventId, query.eventId));
    if (query.projectId) {
      filters.push(eq(eventProjects.projectId, query.projectId));
    }
    if (query.status) {
      filters.push(eq(eventProjects.status, query.status));
    } else if (!query.includeRetired) {
      filters.push(isNull(eventProjects.deletedAt));
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const rows = await this.db
      .select({
        relation: eventProjects,
        eventId: events.id,
        eventSlug: events.slug,
        eventTitle: events.title,
        eventState: events.state,
        eventRecordStatus: events.recordStatus,
        projectId: projects.id,
        projectSlug: projects.slug,
        projectTitle: projects.title,
        projectStatus: projects.status,
      })
      .from(eventProjects)
      .innerJoin(events, eq(events.id, eventProjects.eventId))
      .innerJoin(projects, eq(projects.id, eventProjects.projectId))
      .where(where)
      // Stable total order ending in the relation id — two rows created in the
      // same millisecond must not swap places between pages.
      .orderBy(asc(events.title), asc(projects.title), asc(eventProjects.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await this.db
      .select({ value: count() })
      .from(eventProjects)
      .where(where);

    return {
      rows: rows.map((row) => ({
        relation: row.relation,
        event: {
          id: row.eventId,
          slug: row.eventSlug,
          title: row.eventTitle,
          state: row.eventState,
          recordStatus: row.eventRecordStatus,
        },
        project: {
          id: row.projectId,
          slug: row.projectSlug,
          title: row.projectTitle,
          status: row.projectStatus,
        },
      })),
      total: Number(totals?.value ?? 0),
    };
  }

  /** Resolve a public event by canonical UUID or slug; eligibility is the caller's. */
  async findPublicEvent(key: {
    id?: string;
    slug?: string;
  }): Promise<Event | null> {
    const where = key.id ? eq(events.id, key.id) : eq(events.slug, key.slug!);
    const [row] = await this.db.select().from(events).where(where);
    return row ?? null;
  }

  /** Resolve a public project by canonical UUID or slug; eligibility is the caller's. */
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

  /**
   * §5.2 — the published projects related to one event, keyset-paginated on
   * `(title, id)`. Only ACTIVE relations to PUBLISHED projects are traversed:
   * a retired relation and an unpublished endpoint are both invisible here, and
   * neither is distinguishable from «no such relation» by the caller.
   */
  async listProjectsForEvent(
    eventId: string,
    limit: number,
    after: { title: string; id: string } | null,
  ): Promise<Project[]> {
    const filters = [
      eq(eventProjects.eventId, eventId),
      eq(eventProjects.status, "active"),
      eq(projects.status, "published"),
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
      .select({ project: projects })
      .from(eventProjects)
      .innerJoin(projects, eq(projects.id, eventProjects.projectId))
      .where(and(...filters))
      .orderBy(asc(projects.title), asc(projects.id))
      .limit(limit);
    return rows.map((row) => row.project);
  }

  /**
   * §5.2 — the publish-visible events related to one project, keyset-paginated
   * on `(startsAt, id)`: a broadcast list is read chronologically, so the
   * cursor order is the order the reader already sees.
   */
  async listEventsForProject(
    projectId: string,
    limit: number,
    after: { startsAt: string; id: string } | null,
  ): Promise<Event[]> {
    const filters = [
      eq(eventProjects.projectId, projectId),
      eq(eventProjects.status, "active"),
      eq(events.recordStatus, "active"),
      inArray(events.state, [...PUBLIC_EVENT_STATES]),
    ];
    if (after) {
      const cutoff = new Date(after.startsAt);
      filters.push(
        or(
          gt(events.startsAt, cutoff),
          and(eq(events.startsAt, cutoff), gt(events.id, after.id)),
        )!,
      );
    }
    const rows = await this.db
      .select({ event: events })
      .from(eventProjects)
      .innerJoin(events, eq(events.id, eventProjects.eventId))
      .where(and(...filters))
      .orderBy(asc(events.startsAt), asc(events.id))
      .limit(limit);
    return rows.map((row) => row.event);
  }
}

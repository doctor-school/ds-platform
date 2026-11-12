import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DrizzleHandle, Project } from "@ds/db";
import {
  eventProjects,
  events,
  experts,
  organisationRoles,
  organisations,
  projectExperts,
  projectOrganisations,
  projectOutputKinds,
  projectResults,
  projects,
} from "@ds/db";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { ACTIVE_EVENT } from "../events/events.repository.js";
import {
  organisationPubliclyDisplayed,
  publicOrganisationColumns,
  type PublicOrganisationRow,
} from "./organisation-public-display.js";
import { projectPubliclyVisible } from "./project-public-visibility.js";

// 030 EARS-8 / EARS-9 / EARS-13 (#3505) — the reads behind the Academy's
// catalog, scale line and project page (030-design §«Public projection»).
//
// Every read is scoped by the ONE `projectPubliclyVisible` predicate
// (published, non-retired, ≥1 result) and projects organisations only through
// the 032 display predicate and column set — no copy of either rule here.

/**
 * The event states a broadcast counts in on the scale line and the since-year
 * (030 EARS-9): the 012 public states plus `in_archive`, an event whose
 * recording sits in the archive — it was held, so it is a broadcast.
 */
export const BROADCAST_EVENT_STATES = [
  "published",
  "live",
  "ended",
  "in_archive",
] as const;

export interface PublicCatalogInvestorRow {
  projectId: string;
  title: string;
  logoRef: string | null;
}

export interface PublicProjectOrganisationRow extends PublicOrganisationRow {
  roleTitle: string;
  note: string | null;
  isPrimary: boolean;
}

export interface PublicProjectResultRow {
  kindTitle: string;
  title: string;
  description: string | null;
  storefrontUrl: string | null;
}

export interface BroadcastFigures {
  broadcasts: number;
  firstYear: number | null;
}

@Injectable()
export class PublicProjectsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleHandle["db"]) {}

  /** EARS-8 — the public projects, active stages first, then the operator's order. */
  listCatalog(): Promise<Project[]> {
    return this.db
      .select()
      .from(projects)
      .where(projectPubliclyVisible)
      .orderBy(
        sql`(${projects.stage} = 'completed')`,
        sql`${projects.displayPosition} ASC NULLS LAST`,
        asc(projects.id),
      );
  }

  /** EARS-13 — a public project by canonical UUID or slug; `null` for every other case alike. */
  async findPublic(key: {
    id?: string;
    slug?: string;
  }): Promise<Project | null> {
    const where = key.id
      ? eq(projects.id, key.id)
      : eq(projects.slug, key.slug!);
    const [row] = await this.db
      .select()
      .from(projects)
      .where(and(where, projectPubliclyVisible));
    return row ?? null;
  }

  /** The results of the named projects, each project's in `position` order. */
  resultsOf(
    projectIds: readonly string[],
  ): Promise<(PublicProjectResultRow & { projectId: string })[]> {
    if (projectIds.length === 0) return Promise.resolve([]);
    return this.db
      .select({
        projectId: projectResults.projectId,
        kindTitle: projectOutputKinds.title,
        title: projectResults.title,
        description: projectResults.description,
        storefrontUrl: projectResults.storefrontUrl,
      })
      .from(projectResults)
      .innerJoin(
        projectOutputKinds,
        eq(projectOutputKinds.id, projectResults.outputKindId),
      )
      .where(inArray(projectResults.projectId, [...projectIds]))
      .orderBy(asc(projectResults.projectId), asc(projectResults.position));
  }

  /** The displayable «Инвестор проекта» organisation of each named project (≤1 by the partial unique index). */
  investorsOf(
    projectIds: readonly string[],
  ): Promise<PublicCatalogInvestorRow[]> {
    if (projectIds.length === 0) return Promise.resolve([]);
    return this.db
      .select({
        projectId: projectOrganisations.projectId,
        title: publicOrganisationColumns.title,
        logoRef: publicOrganisationColumns.logoRef,
      })
      .from(projectOrganisations)
      .innerJoin(
        organisations,
        eq(organisations.id, projectOrganisations.organisationId),
      )
      .where(
        and(
          inArray(projectOrganisations.projectId, [...projectIds]),
          eq(projectOrganisations.status, "active"),
          isNull(projectOrganisations.deletedAt),
          eq(projectOrganisations.isPrimary, true),
          organisationPubliclyDisplayed,
        ),
      );
  }

  /** EARS-9 — the number of public projects. */
  async countPublic(): Promise<number> {
    const [row] = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(projects)
      .where(projectPubliclyVisible);
    return row?.value ?? 0;
  }

  /**
   * EARS-9 / EARS-13 — distinct non-removed broadcast events linked by an
   * active `event_projects` row to a public project (optionally one project),
   * and the UTC year of the earliest start among them (the same zone as the
   * first-publish fallback).
   */
  async broadcastFigures(projectId?: string): Promise<BroadcastFigures> {
    const [row] = await this.db
      .select({
        broadcasts: sql<number>`count(DISTINCT ${events.id})::int`,
        firstYear: sql<
          number | null
        >`min(extract(year from ${events.startsAt} AT TIME ZONE 'UTC'))::int`,
      })
      .from(eventProjects)
      .innerJoin(events, eq(events.id, eventProjects.eventId))
      .innerJoin(projects, eq(projects.id, eventProjects.projectId))
      .where(
        and(
          eq(eventProjects.status, "active"),
          ACTIVE_EVENT,
          inArray(events.state, [...BROADCAST_EVENT_STATES]),
          projectPubliclyVisible,
          projectId ? eq(projects.id, projectId) : undefined,
        ),
      );
    return {
      broadcasts: row?.broadcasts ?? 0,
      firstYear: row?.firstYear ?? null,
    };
  }

  /** EARS-13 — the active curator link's published expert, name parts only. */
  async curatorOf(projectId: string): Promise<{
    familyName: string | null;
    givenName: string | null;
    patronymic: string | null;
  } | null> {
    const [row] = await this.db
      .select({
        familyName: experts.familyName,
        givenName: experts.givenName,
        patronymic: experts.patronymic,
      })
      .from(projectExperts)
      .innerJoin(experts, eq(experts.id, projectExperts.expertId))
      .where(
        and(
          eq(projectExperts.projectId, projectId),
          eq(projectExperts.role, "curator"),
          ...publishedExpertLink(),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** EARS-13 — active links to published experts. */
  async countExperts(projectId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(projectExperts)
      .innerJoin(experts, eq(experts.id, projectExperts.expertId))
      .where(
        and(eq(projectExperts.projectId, projectId), ...publishedExpertLink()),
      );
    return row?.value ?? 0;
  }

  /** EARS-13 — whether the project has any active «Инвестор проекта» link, displayable or not. */
  async hasActiveInvestorLink(projectId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: projectOrganisations.id })
      .from(projectOrganisations)
      .where(
        and(
          eq(projectOrganisations.projectId, projectId),
          eq(projectOrganisations.status, "active"),
          isNull(projectOrganisations.deletedAt),
          eq(projectOrganisations.isPrimary, true),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /** EARS-13 — the displayable organisations of a project: the investor first, then by title. */
  organisationsOf(projectId: string): Promise<PublicProjectOrganisationRow[]> {
    return this.db
      .select({
        ...publicOrganisationColumns,
        roleTitle: organisationRoles.title,
        note: projectOrganisations.note,
        isPrimary: projectOrganisations.isPrimary,
      })
      .from(projectOrganisations)
      .innerJoin(
        organisations,
        eq(organisations.id, projectOrganisations.organisationId),
      )
      .innerJoin(
        organisationRoles,
        eq(organisationRoles.id, projectOrganisations.roleId),
      )
      .where(
        and(
          eq(projectOrganisations.projectId, projectId),
          eq(projectOrganisations.status, "active"),
          isNull(projectOrganisations.deletedAt),
          organisationPubliclyDisplayed,
        ),
      )
      .orderBy(
        sql`${projectOrganisations.isPrimary} DESC`,
        asc(organisations.title),
        asc(organisations.id),
      );
  }
}

/** An active project↔expert link whose expert is published — the 012 public expert rule. */
function publishedExpertLink() {
  return [
    eq(projectExperts.status, "active"),
    isNull(projectExperts.deletedAt),
    eq(experts.status, "published"),
    isNull(experts.deletedAt),
    isNull(experts.contentRemovedAt),
  ];
}

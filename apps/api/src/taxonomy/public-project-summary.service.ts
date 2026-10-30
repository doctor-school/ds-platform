import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DrizzleHandle, Project } from "@ds/db";
import { organisations, projectOrganisations } from "@ds/db";
import type { PublicPartnerSummary, PublicProjectSummary } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../storage/index.js";
import {
  organisationPubliclyDisplayed,
  publicOrganisationColumns,
  type PublicOrganisationRow,
} from "./organisation-public-display.js";

// 012 EARS-10 (#1292) — the ONE place a `PublicProjectSummary` is built.
//
// §5.2 fixes `PublicProjectSummary.primaryPartner`, and three separate public
// routes now emit that DTO: `/public/events/:key/projects` (EARS-6),
// `/public/experts/:key/projects` (EARS-9) and `/public/partners/:key/projects`
// (EARS-10). A per-vertical `toProjectSummary()` in each service would be three
// copies of one disclosure decision, and the primary-partner lookup is exactly
// the kind of field a copy silently forgets — which is how `primaryPartner`
// would go back to being `null` on one route while being populated on another.
//
// So the mapping lives here and every caller goes through it. The partner lookup
// is BATCHED over the whole page: one extra query per page rather than one per
// row, which is what keeps a 50-row page from issuing 50 round-trips.
//
// Eligibility of the primary partner is the same display predicate every other
// public traversal applies (`organisation-public-display.ts`, 032 EARS-5): the
// relation is `active` and the partner is published, non-retired and
// name-visible. A project whose primary partner is a draft or name-hidden
// therefore reports `primaryPartner: null`; a logo-hidden one reports
// `logoUrl: null`.

@Injectable()
export class PublicProjectSummaryService {
  constructor(
    // Explicit @Inject tokens — the root-level `endpoint-authz` gate boots this
    // module graph under `tsx`, which emits no `design:paramtypes`, so a
    // type-inferred injection resolves to `undefined` there.
    @Inject(DRIZZLE_DB) private readonly db: DrizzleHandle["db"],
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** The §5.2 summaries of one page of projects, primary partners populated. */
  async summarize(rows: readonly Project[]): Promise<PublicProjectSummary[]> {
    if (rows.length === 0) return [];
    const primaries = await this.primaryPartnersOf(rows.map((row) => row.id));
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        slug: row.slug,
        kind: row.kind,
        title: row.title,
        description: row.description,
        coverUrl: row.coverRef ? await this.storage.urlFor(row.coverRef) : null,
        primaryPartner: primaries.get(row.id) ?? null,
      })),
    );
  }

  /** The single-row form — the same mapping, never a second one. */
  async summarizeOne(row: Project): Promise<PublicProjectSummary> {
    const [summary] = await this.summarize([row]);
    return summary!;
  }

  /**
   * The publicly eligible primary partner of each named project, keyed by
   * project id. At most one row per project can qualify: the partial unique
   * index `project_organisations_project_primary_active_uniq` is the guarantee, so
   * this map never silently drops a second candidate.
   */
  private async primaryPartnersOf(
    projectIds: readonly string[],
  ): Promise<Map<string, PublicPartnerSummary>> {
    const unique = [...new Set(projectIds)];
    const rows = await this.db
      .select({
        projectId: projectOrganisations.projectId,
        ...publicOrganisationColumns,
      })
      .from(projectOrganisations)
      .innerJoin(
        organisations,
        eq(organisations.id, projectOrganisations.organisationId),
      )
      .where(
        and(
          inArray(projectOrganisations.projectId, unique),
          eq(projectOrganisations.status, "active"),
          isNull(projectOrganisations.deletedAt),
          eq(projectOrganisations.isPrimary, true),
          organisationPubliclyDisplayed,
        ),
      );

    const map = new Map<string, PublicPartnerSummary>();
    for (const { projectId, ...partner } of rows) {
      map.set(projectId, await toPartnerSummary(partner, this.storage));
    }
    return map;
  }
}

/**
 * The §5.2 public summary of one partner — shared by both §5.2 partner reads.
 * `row` comes from `publicOrganisationColumns`, so `logoRef` is already null
 * for a logo-hidden organisation (032 EARS-5). Signed at read time — the bucket
 * is private, so an unsigned URL is dead (#842); PRESENT and nullable so the
 * client renders its fallback.
 */
export async function toPartnerSummary(
  row: PublicOrganisationRow,
  storage: ObjectStorage,
): Promise<PublicPartnerSummary> {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    logoUrl: row.logoRef ? await storage.urlFor(row.logoRef) : null,
    websiteUrl: row.websiteUrl,
  };
}

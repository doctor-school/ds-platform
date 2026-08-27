import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DrizzleHandle, Project } from "@ds/db";
import { partners, projectPartners } from "@ds/db";
import type { PublicPartnerSummary, PublicProjectSummary } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../storage/index.js";

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
// Eligibility of the primary partner is the same publish-visibility test §5.2
// applies to every other public traversal: the relation is `active` and the
// partner itself is `published` and non-retired. A project whose primary partner
// is still a draft therefore reports `primaryPartner: null` — truthfully, since
// nothing about that partner is public yet.

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
   * index `project_partners_project_primary_active_uniq` is the guarantee, so
   * this map never silently drops a second candidate.
   */
  private async primaryPartnersOf(
    projectIds: readonly string[],
  ): Promise<Map<string, PublicPartnerSummary>> {
    const unique = [...new Set(projectIds)];
    const rows = await this.db
      .select({
        projectId: projectPartners.projectId,
        id: partners.id,
        slug: partners.slug,
        title: partners.title,
        logoRef: partners.logoRef,
        websiteUrl: partners.websiteUrl,
      })
      .from(projectPartners)
      .innerJoin(partners, eq(partners.id, projectPartners.partnerId))
      .where(
        and(
          inArray(projectPartners.projectId, unique),
          eq(projectPartners.status, "active"),
          isNull(projectPartners.deletedAt),
          eq(projectPartners.isPrimary, true),
          eq(partners.status, "published"),
          isNull(partners.deletedAt),
        ),
      );

    const map = new Map<string, PublicPartnerSummary>();
    for (const row of rows) {
      map.set(row.projectId, {
        id: row.id,
        slug: row.slug,
        title: row.title,
        // Signed at read time — the bucket is private, so an unsigned URL is
        // dead (#842); PRESENT and nullable so the client renders its fallback.
        logoUrl: row.logoRef ? await this.storage.urlFor(row.logoRef) : null,
        websiteUrl: row.websiteUrl,
      });
    }
    return map;
  }
}

/** The §5.2 public summary of one partner — shared by both §5.2 partner reads. */
export async function toPartnerSummary(
  row: {
    id: string;
    slug: string;
    title: string;
    logoRef: string | null;
    websiteUrl: string | null;
  },
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

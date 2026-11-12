import { Inject, Injectable } from "@nestjs/common";
import type { Project } from "@ds/db";
import {
  expertDisplayName,
  type PublicProject,
  type PublicProjectCatalog,
  type PublicProjectCatalogItem,
  type PublicProjectResultList,
  type PublicProjectScale,
} from "@ds/schemas";
import { OBJECT_STORAGE, type ObjectStorage } from "../storage/index.js";
import { ProjectPartnersService } from "./project-partners.service.js";
import { PublicProjectsRepository } from "./public-projects.repository.js";
import { TaxonomyError } from "./taxonomy.errors.js";

// 030 EARS-8 / EARS-9 / EARS-13 (#3505) — the Academy's public project reads.
//
// The scale line's `partners` is the 032 EARS-12 count, read through the same
// service method behind `GET /v1/public/organisations/count`, so the two
// figures cannot drift apart. Storage keys are signed at read time (the bucket
// is private, #842) and never leave this service.

export type PublicProjectKey = { id: string } | { slug: string };

@Injectable()
export class PublicProjectsService {
  constructor(
    // Explicit @Inject tokens — the root-level `endpoint-authz` gate boots this
    // module graph under `tsx`, which emits no `design:paramtypes`.
    @Inject(PublicProjectsRepository)
    private readonly repo: PublicProjectsRepository,
    @Inject(ProjectPartnersService)
    private readonly organisations: ProjectPartnersService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** EARS-8 — the catalog cards in stage-then-operator order. */
  async catalog(): Promise<PublicProjectCatalog> {
    const rows = await this.repo.listCatalog();
    const ids = rows.map((row) => row.id);
    const [results, investors] = await Promise.all([
      this.repo.resultsOf(ids),
      this.repo.investorsOf(ids),
    ]);

    const outputs = new Map<string, string[]>();
    for (const result of results) {
      const list = outputs.get(result.projectId) ?? [];
      if (!list.includes(result.kindTitle)) list.push(result.kindTitle);
      outputs.set(result.projectId, list);
    }
    const investorOf = new Map(investors.map((row) => [row.projectId, row]));

    const data = await Promise.all(
      rows.map(async (row): Promise<PublicProjectCatalogItem> => {
        const investor = investorOf.get(row.id);
        return {
          ...(await this.hero(row)),
          outputs: outputs.get(row.id) ?? [],
          investor: investor
            ? {
                title: investor.title,
                logoUrl: await this.url(investor.logoRef),
              }
            : null,
        };
      }),
    );
    return { data };
  }

  /** EARS-9 — the scale line, computed at the moment of the request. */
  async scale(): Promise<PublicProjectScale> {
    const [projects, partners, broadcast] = await Promise.all([
      this.repo.countPublic(),
      this.organisations.publicOrganisationCount(),
      this.repo.broadcastFigures(),
    ]);
    return {
      projects,
      partners: partners.count,
      broadcasts: broadcast.broadcasts,
      firstBroadcastYear: broadcast.firstYear,
    };
  }

  /** EARS-13 — the project page; 404 for draft, retired, non-public and unknown alike. */
  async project(key: PublicProjectKey): Promise<PublicProject> {
    const row = await this.resolve(key);
    const [
      curator,
      results,
      expertCount,
      broadcast,
      organisations,
      hasInvestor,
    ] = await Promise.all([
      this.repo.curatorOf(row.id),
      this.repo.resultsOf([row.id]),
      this.repo.countExperts(row.id),
      this.repo.broadcastFigures(row.id),
      this.repo.organisationsOf(row.id),
      this.repo.hasActiveInvestorLink(row.id),
    ]);
    return {
      ...(await this.hero(row)),
      curatorName: curator ? expertDisplayName(curator) : null,
      resultCount: results.length,
      expertCount,
      sinceYear: broadcast.firstYear ?? sinceYearOfPublish(row),
      organisations: await Promise.all(
        organisations.map(async (org) => ({
          title: org.title,
          logoUrl: await this.url(org.logoRef),
          roleTitle: org.roleTitle,
          note: org.note,
          isInvestor: org.isPrimary,
        })),
      ),
      investorPlaceOpen: !hasInvestor,
    };
  }

  /** EARS-13 — the project's results in order; the same 404 as the project read. */
  async results(key: PublicProjectKey): Promise<PublicProjectResultList> {
    const row = await this.resolve(key);
    const results = await this.repo.resultsOf([row.id]);
    return {
      data: results.map(({ kindTitle, title, description, storefrontUrl }) => ({
        kindTitle,
        title,
        description,
        storefrontUrl,
      })),
    };
  }

  private async resolve(key: PublicProjectKey): Promise<Project> {
    const row = await this.repo.findPublic(key);
    if (!row) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    return row;
  }

  private async hero(row: Project) {
    return {
      slug: row.slug,
      title: row.title,
      description: row.description,
      coverUrl: await this.url(row.coverRef),
      stage: row.stage,
      stageNote: row.stageNote,
    };
  }

  private url(ref: string | null): Promise<string | null> {
    return ref ? this.storage.urlFor(ref) : Promise.resolve(null);
  }
}

/**
 * The since-year fallback: the year of the first publish. A public project is
 * published, and the publish transaction sets `first_published_at` once, so
 * it is present on every row this service resolves.
 */
function sinceYearOfPublish(row: Project): number {
  if (!row.firstPublishedAt) {
    throw new Error(`public project ${row.id} has no first_published_at`);
  }
  return row.firstPublishedAt.getUTCFullYear();
}

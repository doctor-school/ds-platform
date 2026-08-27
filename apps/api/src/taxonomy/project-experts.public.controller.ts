import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Query,
  UseFilters,
} from "@nestjs/common";
import {
  CANONICAL_UUID_REGEX,
  PublicCursorQuerySchema,
  type PublicExpertProjectItemPage,
  type PublicProjectExpertItemPage,
} from "@ds/schemas";
import { Authz, Public } from "../authz/index.js";
import {
  ProjectExpertsService,
  type PublicKey,
} from "./project-experts.service.js";
import { TaxonomyError } from "./taxonomy.errors.js";
import { TaxonomyProblemFilter } from "./taxonomy.problem-filter.js";

// 012 EARS-9 (#1291) — the two §5.2 public traversals of the project↔expert
// relationship, mounted on the same public surface pattern as the event↔project
// pair: `@Public()` so the 003 authentication layer skips the subject
// requirement, `@Authz({ access: "public" })` as the SSOT the global guard, the
// completeness gate and the matrix all read, and a short `Cache-Control`
// because neither body varies per session.
//
// They live in the taxonomy module rather than beside the entity controllers
// because the RELATIONSHIP, not the project or the expert, is what they read:
// the query, the eligibility rule and the cursor all belong to
// `ProjectExpertsService`.
//
// Visibility policy (§5.2), identical in both directions:
// - an unknown OR not-publicly-eligible source is 404, indistinguishable from
//   each other, so a draft leaks no "exists but private" oracle;
// - an eligible source with no eligible relations is an ordinary empty page,
//   never a 404 — "this project has no experts yet" is a fact, not an error.
//
// The role is part of the public item (`PublicExpertSummary + { role }`): who
// CURATES a project is public editorial information, and the audience surface
// renders the curator differently from the members.

/** The §5.2 public key: a canonical UUID addresses by id, anything else by slug. */
function publicKey(token: string): PublicKey {
  return CANONICAL_UUID_REGEX.test(token) ? { id: token } : { slug: token };
}

function parseCursorQuery(raw: Record<string, string>) {
  const parsed = PublicCursorQuerySchema.safeParse(raw);
  if (!parsed.success) {
    throw new TaxonomyError(
      "VALIDATION_FAILED",
      "invalid page query",
      parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    );
  }
  return parsed.data;
}

@Controller({ path: "public/projects", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class ProjectExpertsPublicController {
  // Explicit @Inject token — the root-level authz gate boots this graph under
  // `tsx`, which emits no `design:paramtypes` (see `topics.service.ts`).
  constructor(
    @Inject(ProjectExpertsService)
    private readonly relations: ProjectExpertsService,
  ) {}

  /**
   * §5.2 — `GET /v1/public/projects/:idOrSlug/experts`. The experts a published
   * project lists, as exactly `PublicExpertSummary + { role }`, cursor-paginated
   * in a stable name order.
   */
  @Get(":idOrSlug/experts")
  @Public()
  @Header("Cache-Control", "public, max-age=30")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-9", "EARS-16"],
  })
  experts(
    @Param("idOrSlug") idOrSlug: string,
    @Query() rawQuery: Record<string, string>,
  ): Promise<PublicProjectExpertItemPage> {
    return this.relations.publicExpertsForProject(
      publicKey(idOrSlug),
      parseCursorQuery(rawQuery),
    );
  }
}

@Controller({ path: "public/experts", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class ExpertProjectsPublicController {
  constructor(
    @Inject(ProjectExpertsService)
    private readonly relations: ProjectExpertsService,
  ) {}

  /**
   * §5.2 — `GET /v1/public/experts/:idOrSlug/projects`. The reverse traversal:
   * the published projects a publicly visible expert is listed on, as exactly
   * `PublicProjectSummary + { role }` (so `primaryPartner` is populated here
   * exactly as on every other summary route), cursor-paginated by title.
   */
  @Get(":idOrSlug/projects")
  @Public()
  @Header("Cache-Control", "public, max-age=30")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-9", "EARS-16"],
  })
  projects(
    @Param("idOrSlug") idOrSlug: string,
    @Query() rawQuery: Record<string, string>,
  ): Promise<PublicExpertProjectItemPage> {
    return this.relations.publicProjectsForExpert(
      publicKey(idOrSlug),
      parseCursorQuery(rawQuery),
    );
  }
}

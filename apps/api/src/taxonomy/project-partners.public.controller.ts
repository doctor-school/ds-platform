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
  type PublicPartnerProjectItemPage,
  type PublicProjectPartnerItemPage,
} from "@ds/schemas";
import { Authz, Public } from "../authz/index.js";
import {
  ProjectPartnersService,
  type PublicKey,
} from "./project-partners.service.js";
import { TaxonomyError } from "./taxonomy.errors.js";
import { TaxonomyProblemFilter } from "./taxonomy.problem-filter.js";

// 012 EARS-10 (#1292) — the two §5.2 public traversals of the project↔partner
// relationship, on the same public surface pattern as every sibling: `@Public()`
// so the 003 authentication layer skips the subject requirement,
// `@Authz({ access: "public" })` as the SSOT the global guard, the completeness
// gate and the matrix all read, and a short `Cache-Control` because neither body
// varies per session.
//
// Disclosure (§5.2): the item is exactly the public partner (or project) summary
// plus ONE boolean, `isPrimary`. The join id, the relation's status/version and
// every commercial term stay on the admin surface — a sponsorship's terms are
// not public information, "who sponsors this and which one leads" is.
//
// Visibility policy, identical in both directions: an unknown OR
// not-publicly-eligible source is 404, indistinguishable from each other; an
// eligible source with no eligible relations is an ordinary empty page.

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
export class ProjectPartnersPublicController {
  // Explicit @Inject token — the root-level authz gate boots this graph under
  // `tsx`, which emits no `design:paramtypes` (see `topics.service.ts`).
  constructor(
    @Inject(ProjectPartnersService)
    private readonly relations: ProjectPartnersService,
  ) {}

  /**
   * §5.2 — `GET /v1/public/projects/:idOrSlug/partners`. The partners a
   * published project lists, as exactly `PublicPartnerSummary + { isPrimary }`,
   * cursor-paginated in a stable title order.
   */
  @Get(":idOrSlug/partners")
  @Public()
  @Header("Cache-Control", "public, max-age=30")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-10", "EARS-16"],
  })
  partners(
    @Param("idOrSlug") idOrSlug: string,
    @Query() rawQuery: Record<string, string>,
  ): Promise<PublicProjectPartnerItemPage> {
    return this.relations.publicPartnersForProject(
      publicKey(idOrSlug),
      parseCursorQuery(rawQuery),
    );
  }
}

@Controller({ path: "public/partners", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class PartnerProjectsPublicController {
  constructor(
    @Inject(ProjectPartnersService)
    private readonly relations: ProjectPartnersService,
  ) {}

  /**
   * §5.2 — `GET /v1/public/partners/:idOrSlug/projects`. The reverse traversal:
   * the published projects a publicly visible partner sponsors, as exactly
   * `PublicProjectSummary + { isPrimary }` (so `primaryPartner` is populated
   * here exactly as on every other summary route), cursor-paginated by title.
   */
  @Get(":idOrSlug/projects")
  @Public()
  @Header("Cache-Control", "public, max-age=30")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-10", "EARS-16"],
  })
  projects(
    @Param("idOrSlug") idOrSlug: string,
    @Query() rawQuery: Record<string, string>,
  ): Promise<PublicPartnerProjectItemPage> {
    return this.relations.publicProjectsForPartner(
      publicKey(idOrSlug),
      parseCursorQuery(rawQuery),
    );
  }
}

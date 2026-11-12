import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  UseFilters,
} from "@nestjs/common";
import {
  CANONICAL_UUID_REGEX,
  type PublicProject,
  type PublicProjectCatalog,
  type PublicProjectResultList,
  type PublicProjectScale,
} from "@ds/schemas";
import { Authz, Public } from "../authz/index.js";
import {
  PublicProjectsService,
  type PublicProjectKey,
} from "./public-projects.service.js";
import { TaxonomyProblemFilter } from "./taxonomy.problem-filter.js";

// 030 EARS-8 / EARS-9 / EARS-13 (#3505) — the Academy's public project reads,
// on the public taxonomy surface pattern: `@Public()` so the 003
// authentication layer skips the subject requirement, `@Authz({ access:
// "public" })` as the SSOT the global guard and the matrix read, and the same
// short `Cache-Control` as the sibling `/v1/public/projects/:key/…` reads.
//
// `scale` is a literal segment declared before `:idOrSlug`, and the project
// slugifier reserves `scale` and `order` (`taxonomy-slug.ts`), so no project
// can own either address.

/** The 012 public key: a canonical UUID addresses by id, anything else by slug. */
function publicKey(token: string): PublicProjectKey {
  return CANONICAL_UUID_REGEX.test(token) ? { id: token } : { slug: token };
}

@Controller({ path: "public/projects", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class PublicProjectsController {
  constructor(
    @Inject(PublicProjectsService)
    private readonly projects: PublicProjectsService,
  ) {}

  /** EARS-8 — `GET /v1/public/projects`: the catalog cards. */
  @Get()
  @Public()
  @Header("Cache-Control", "public, max-age=30")
  @Authz({ access: "public", check: "none", audit: "none", tests: ["EARS-8"] })
  catalog(): Promise<PublicProjectCatalog> {
    return this.projects.catalog();
  }

  /** EARS-9 — `GET /v1/public/projects/scale`: the scale line. */
  @Get("scale")
  @Public()
  @Header("Cache-Control", "public, max-age=30")
  @Authz({ access: "public", check: "none", audit: "none", tests: ["EARS-9"] })
  scale(): Promise<PublicProjectScale> {
    return this.projects.scale();
  }

  /** EARS-13 — `GET /v1/public/projects/:idOrSlug`: the project page. */
  @Get(":idOrSlug")
  @Public()
  @Header("Cache-Control", "public, max-age=30")
  @Authz({ access: "public", check: "none", audit: "none", tests: ["EARS-13"] })
  project(@Param("idOrSlug") idOrSlug: string): Promise<PublicProject> {
    return this.projects.project(publicKey(idOrSlug));
  }

  /** EARS-13 — `GET /v1/public/projects/:idOrSlug/results`: the results block. */
  @Get(":idOrSlug/results")
  @Public()
  @Header("Cache-Control", "public, max-age=30")
  @Authz({ access: "public", check: "none", audit: "none", tests: ["EARS-13"] })
  results(
    @Param("idOrSlug") idOrSlug: string,
  ): Promise<PublicProjectResultList> {
    return this.projects.results(publicKey(idOrSlug));
  }
}

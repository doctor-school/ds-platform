import { Controller, Get, Inject, UseFilters } from "@nestjs/common";
import type { PublicExpertCount } from "@ds/schemas";
import { Authz, Public } from "../authz/index.js";
import { ExpertsService } from "./experts.service.js";
import { TaxonomyProblemFilter } from "./taxonomy.problem-filter.js";

// 029 EARS-4 (#4242) — the public read of the 012 expert REGISTRY itself, as
// opposed to the project↔expert traversals in `project-experts.public.controller.ts`
// that read the relationship. Same public surface pattern as the 032 EARS-12
// organisation count: `@Public()` so the 003 authentication layer skips the
// subject requirement, `@Authz({ access: "public" })` as the SSOT the global
// guard, the completeness gate and the matrix all read.

@Controller({ path: "public/experts", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class ExpertCountPublicController {
  // Explicit @Inject token — the root-level authz gate boots this graph under
  // `tsx`, which emits no `design:paramtypes` (see `directions.service.ts`).
  constructor(
    @Inject(ExpertsService) private readonly experts: ExpertsService,
  ) {}

  /**
   * 029 EARS-4 — `GET /v1/public/experts/count`: `{ count }` of the published
   * experts, computed per request. The Academy home is its only storefront
   * consumer; it owns any HTTP cache, so this route sends none.
   */
  @Get("count")
  @Public()
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-4"],
  })
  count(): Promise<PublicExpertCount> {
    return this.experts.publicCount();
  }
}

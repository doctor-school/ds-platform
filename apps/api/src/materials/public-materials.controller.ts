import { Controller, Get, Inject, Param, UseFilters } from "@nestjs/common";
import type { PublicMaterial } from "@ds/schemas";
import { Authz, Public } from "../authz/index.js";
import { TaxonomyProblemFilter } from "../taxonomy/index.js";
import { MaterialsPublicReadsService } from "./public-reads.service.js";

// 048 EARS-11, EARS-19 (#3513) — `GET /v1/public/materials/{slug}`, the
// anonymous material read of the reading page. A draft, unknown or non-public
// material answers the identical `404`. No Cache-Control, as the feed.

@Controller({ path: "public/materials", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class PublicMaterialsController {
  constructor(
    @Inject(MaterialsPublicReadsService)
    private readonly reads: MaterialsPublicReadsService,
  ) {}

  @Get(":slug")
  @Public()
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-11", "EARS-19"],
  })
  material(@Param("slug") slug: string): Promise<PublicMaterial> {
    return this.reads.material(slug);
  }
}

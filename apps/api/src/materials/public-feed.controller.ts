import { Controller, Get, Inject, Query, UseFilters } from "@nestjs/common";
import { type PublicFeedPage, PublicFeedQuerySchema } from "@ds/schemas";
import { Authz, Public } from "../authz/index.js";
import { TaxonomyError, TaxonomyProblemFilter } from "../taxonomy/index.js";
import { MaterialsPublicReadsService } from "./public-reads.service.js";

// 048 EARS-9, EARS-10, EARS-19 (#3513) — `GET /v1/public/feed`, the anonymous
// feed page the Academy home rail reads. Same public surface pattern as the
// 012/032 public controllers: `@Public()` for the 003 layer, `@Authz` as the
// SSOT of the guard, the completeness gate and the matrix. No Cache-Control:
// an unpublished material leaves the feed on the next read (EARS-6), and the
// storefront owns its own revalidation.

@Controller({ path: "public/feed", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class PublicFeedController {
  // Explicit @Inject token — the root-level authz gate boots this graph under
  // `tsx`, which emits no `design:paramtypes`.
  constructor(
    @Inject(MaterialsPublicReadsService)
    private readonly reads: MaterialsPublicReadsService,
  ) {}

  @Get()
  @Public()
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-9", "EARS-10", "EARS-19"],
  })
  feed(@Query() rawQuery: Record<string, string>): Promise<PublicFeedPage> {
    const parsed = PublicFeedQuerySchema.safeParse(rawQuery);
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
    return this.reads.feedPage(parsed.data);
  }
}

import { Controller, Get, Header, Inject, UseFilters } from "@nestjs/common";
import type { FrequentSpecialties, SpecialtyBook } from "@ds/schemas";
import { Authz, Public } from "../authz/index.js";
import { SpecialtiesService } from "./specialties.service.js";
import { SpecialtyProblemFilter } from "./specialties.problem-filter.js";

// 017 EARS-3 (#1479) — the public read of the closed Минздрав specialty book.
//
// Same public-surface pattern as the 012 traversals: `@Public()` so the 003
// authentication layer skips the subject requirement, `@Authz({access:"public"})`
// as the SSOT the global guard, the completeness gate and the generated matrix
// all read, and a `Cache-Control` — longer here (5 minutes) than on the 012
// content reads, because a reference book only changes when a nomenclature order
// does, and the body is byte-for-byte identical for a guest and a logged-in
// doctor.
//
// ONLY `@Get` handlers are declared. The book is seeded, never authored, so
// there is no mutating verb to authorize — a mutating request finds no route at
// all rather than a 403 that would imply one could be permitted (EARS-3).
//
// Specialties stay a DISTINCT read model: this path serves specialty rows and
// nothing else — directions (#1483) and schools get their own reads, never a
// merged list under a shared label.

@Controller({ path: "public/specialties", version: "1" })
@UseFilters(SpecialtyProblemFilter)
export class SpecialtiesPublicController {
  // Explicit @Inject token — the API boots under `tsx`, which emits no
  // `design:paramtypes`.
  constructor(
    @Inject(SpecialtiesService)
    private readonly specialties: SpecialtiesService,
  ) {}

  /** `GET /v1/public/specialties` — the whole book plus its `total`. */
  @Get()
  @Public()
  @Header("Cache-Control", "public, max-age=300")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-3"],
  })
  book(): Promise<SpecialtyBook> {
    return this.specialties.book();
  }

  /** `GET /v1/public/specialties/frequent` — the ordered frequent subset. */
  @Get("frequent")
  @Public()
  @Header("Cache-Control", "public, max-age=300")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-3"],
  })
  frequent(): Promise<FrequentSpecialties> {
    return this.specialties.frequent();
  }
}

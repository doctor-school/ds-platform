import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Inject,
  Query,
  UseFilters,
} from "@nestjs/common";
import type {
  FrequentSpecialties,
  SpecialtyBook,
  SpecialtySearchResult,
} from "@ds/schemas";
import { SpecialtySearchQuerySchema } from "@ds/schemas";
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

  /**
   * `GET /v1/public/specialties/search?q=…` — the whole book narrowed by the
   * shared matching rule (EARS-5, 017-design §7 row «specialty search»).
   *
   * The narrowing happens SERVER-side over the whole book so that the storefront
   * never has to hold, or re-derive, a second copy of the reference book to
   * search it — and so that the fold rule has exactly one implementation.
   *
   * A missing `q` is the Open state, not a client error: the read then serves
   * the whole book. An over-long or non-string `q` is refused at the boundary
   * (400) rather than scanned — the book has no legitimate query longer than
   * one of its own entries.
   */
  @Get("search")
  @Public()
  @Header("Cache-Control", "public, max-age=300")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-5"],
  })
  search(@Query("q") q?: unknown): Promise<SpecialtySearchResult> {
    const parsed = SpecialtySearchQuerySchema.safeParse(q ?? "");
    if (!parsed.success) throw new BadRequestException("Invalid query");
    return this.specialties.search(parsed.data);
  }
}

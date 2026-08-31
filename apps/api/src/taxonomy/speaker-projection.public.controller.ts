import { Controller, Get, Header, Inject, Param, UseFilters } from "@nestjs/common";
import { CANONICAL_UUID_REGEX, type PublicEventSpeakerList } from "@ds/schemas";
import { Authz, Public } from "../authz/index.js";
import type { PublicEventKey } from "./speaker-projection.repository.js";
import { SpeakerProjectionService } from "./speaker-projection.service.js";
import { TaxonomyProblemFilter } from "./taxonomy.problem-filter.js";

// 012 EARS-8 (#1290) — `GET /v1/public/events/:idOrSlug/speakers`, the
// standalone half of the canonical merged speaker projection (012-design §5.2).
//
// It mounts on the same public surface pattern as its 004 and 012 siblings:
// `@Public()` so the 003 authentication layer skips the subject requirement,
// `@Authz({ access: "public" })` as the SSOT the global guard, the completeness
// gate and the matrix all read, and a short `Cache-Control` because the body
// carries no per-session variation.
//
// It lives in the taxonomy module rather than the events one for the same
// reason the event↔project traversals do: the merge policy, the eligibility
// predicate and the ordering all belong to `SpeakerProjectionService`, and the
// event contributes only the parent key. The 004 event page reaches the SAME
// service from the events module (`EventsModule` imports `TaxonomyModule`), so
// there is exactly one implementation behind both bodies.
//
// Visibility (§5.2 / EARS-16): an unknown key and a non-public (`draft`) event
// are one indistinguishable 404 `RESOURCE_NOT_FOUND` in RFC 7807 form; an
// eligible event with no visible speaker is an ordinary `200 []`, never a 404 —
// "this event has no speakers yet" is a fact, not an error.

/** The §5.2 public key: a canonical UUID addresses by id, anything else by slug. */
function publicKey(token: string): PublicEventKey {
  return CANONICAL_UUID_REGEX.test(token) ? { id: token } : { slug: token };
}

@Controller({ path: "public/events", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class EventSpeakersPublicController {
  // Explicit @Inject token — the root-level authz gate boots this graph under
  // `tsx`, which emits no `design:paramtypes` (see `directions.service.ts`).
  constructor(
    @Inject(SpeakerProjectionService)
    private readonly speakers: SpeakerProjectionService,
  ) {}

  @Get(":idOrSlug/speakers")
  @Public()
  @Header("Cache-Control", "public, max-age=30")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-8", "EARS-16"],
  })
  list(@Param("idOrSlug") idOrSlug: string): Promise<PublicEventSpeakerList> {
    return this.speakers.publicSpeakersFor(publicKey(idOrSlug));
  }
}

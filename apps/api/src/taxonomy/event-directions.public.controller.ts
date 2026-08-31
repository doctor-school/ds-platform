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
  type PublicEventSummaryPage,
  type PublicDirectionSummaryPage,
  PublicCursorQuerySchema,
} from "@ds/schemas";
import { Authz, Public } from "../authz/index.js";
import {
  EventDirectionsService,
  type PublicKey,
} from "./event-directions.service.js";
import { TaxonomyError } from "./taxonomy.errors.js";
import { TaxonomyProblemFilter } from "./taxonomy.problem-filter.js";

// 012 EARS-11 (#1293) — the two §5.2 public traversals of the event↔direction
// relationship, on the same public surface pattern feature 004 established:
// `@Public()` so the 003 authentication layer skips the subject requirement,
// `@Authz({ access: "public" })` as the SSOT the global guard, the completeness
// gate and the matrix all read, and a short `Cache-Control` because neither
// body varies per session — a guest and a logged-in doctor receive
// byte-for-byte the same page.
//
// Nest binds one path per controller class, and these are two different paths,
// so this file declares TWO classes. The param is named `:idOrSlug` to match
// the sibling public routes it shares a path prefix with.
//
// Neither direction exposes `events.specialties[]`: the item DTOs are exactly
// §5.2's `PublicDirectionSummary` and `PublicEventSummary`, and a reader of
// «направления эфира» is reading the curated direction axis, not the legacy
// specialty array.
//
// Visibility policy (§5.2), identical in both directions:
// - an unknown OR not-publicly-eligible source is 404, indistinguishable from
//   each other, so a draft leaks no "exists but private" oracle;
// - an eligible source with no eligible relations is an ordinary empty page,
//   never a 404 — "this event has no directions yet" is a fact, not an error.

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

@Controller({ path: "public/events", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class EventDirectionsPublicController {
  // Explicit @Inject token — the root-level authz gate boots this graph under
  // `tsx`, which emits no `design:paramtypes` (see `directions.service.ts`).
  constructor(
    @Inject(EventDirectionsService)
    private readonly relations: EventDirectionsService,
  ) {}

  /**
   * §5.2 — `GET /v1/public/events/:idOrSlug/directions`. The directions a
   * publish-visible event is classified under, as exactly `PublicDirectionSummary`
   * rows, cursor-paginated in a stable title order.
   */
  @Get(":idOrSlug/directions")
  @Public()
  @Header("Cache-Control", "public, max-age=30")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-11", "EARS-16"],
  })
  directions(
    @Param("idOrSlug") idOrSlug: string,
    @Query() rawQuery: Record<string, string>,
  ): Promise<PublicDirectionSummaryPage> {
    return this.relations.publicDirectionsForEvent(
      publicKey(idOrSlug),
      parseCursorQuery(rawQuery),
    );
  }
}

@Controller({ path: "public/directions", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class DirectionEventsPublicController {
  constructor(
    @Inject(EventDirectionsService)
    private readonly relations: EventDirectionsService,
  ) {}

  /**
   * §5.2 — `GET /v1/public/directions/:idOrSlug/events`. The reverse traversal: the
   * publish-visible events a published direction classifies, as exactly
   * `PublicEventSummary` rows, cursor-paginated by air date.
   */
  @Get(":idOrSlug/events")
  @Public()
  @Header("Cache-Control", "public, max-age=30")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-11", "EARS-16"],
  })
  events(
    @Param("idOrSlug") idOrSlug: string,
    @Query() rawQuery: Record<string, string>,
  ): Promise<PublicEventSummaryPage> {
    return this.relations.publicEventsForDirection(
      publicKey(idOrSlug),
      parseCursorQuery(rawQuery),
    );
  }
}

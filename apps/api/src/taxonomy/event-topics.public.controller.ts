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
  type PublicTopicSummaryPage,
  PublicCursorQuerySchema,
} from "@ds/schemas";
import { Authz, Public } from "../authz/index.js";
import {
  EventTopicsService,
  type PublicKey,
} from "./event-topics.service.js";
import { TaxonomyError } from "./taxonomy.errors.js";
import { TaxonomyProblemFilter } from "./taxonomy.problem-filter.js";

// 012 EARS-11 (#1293) — the two §5.2 public traversals of the event↔topic
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
// §5.2's `PublicTopicSummary` and `PublicEventSummary`, and a reader of «темы
// эфира» is reading the curated topic axis, not the legacy specialty array.
//
// Visibility policy (§5.2), identical in both directions:
// - an unknown OR not-publicly-eligible source is 404, indistinguishable from
//   each other, so a draft leaks no "exists but private" oracle;
// - an eligible source with no eligible relations is an ordinary empty page,
//   never a 404 — "this event has no topics yet" is a fact, not an error.

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
export class EventTopicsPublicController {
  // Explicit @Inject token — the root-level authz gate boots this graph under
  // `tsx`, which emits no `design:paramtypes` (see `topics.service.ts`).
  constructor(
    @Inject(EventTopicsService)
    private readonly relations: EventTopicsService,
  ) {}

  /**
   * §5.2 — `GET /v1/public/events/:idOrSlug/topics`. The topics a
   * publish-visible event is classified under, as exactly `PublicTopicSummary`
   * rows, cursor-paginated in a stable title order.
   */
  @Get(":idOrSlug/topics")
  @Public()
  @Header("Cache-Control", "public, max-age=30")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-11", "EARS-16"],
  })
  topics(
    @Param("idOrSlug") idOrSlug: string,
    @Query() rawQuery: Record<string, string>,
  ): Promise<PublicTopicSummaryPage> {
    return this.relations.publicTopicsForEvent(
      publicKey(idOrSlug),
      parseCursorQuery(rawQuery),
    );
  }
}

@Controller({ path: "public/topics", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class TopicEventsPublicController {
  constructor(
    @Inject(EventTopicsService)
    private readonly relations: EventTopicsService,
  ) {}

  /**
   * §5.2 — `GET /v1/public/topics/:idOrSlug/events`. The reverse traversal: the
   * publish-visible events a published topic classifies, as exactly
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
    return this.relations.publicEventsForTopic(
      publicKey(idOrSlug),
      parseCursorQuery(rawQuery),
    );
  }
}

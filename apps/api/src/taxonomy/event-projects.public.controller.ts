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
  type PublicProjectSummaryPage,
  PublicCursorQuerySchema,
} from "@ds/schemas";
import { Authz, Public } from "../authz/index.js";
import {
  EventProjectsService,
  type PublicKey,
} from "./event-projects.service.js";
import { TaxonomyError } from "./taxonomy.errors.js";
import { TaxonomyProblemFilter } from "./taxonomy.problem-filter.js";

// 012 EARS-6 (#1288) — the two §5.2 public traversals of the event↔project
// relationship. They mount on the SAME public surface pattern feature 004
// established (`apps/api/src/events/events.public.controller.ts`): `@Public()`
// so the 003 authentication layer skips the subject requirement,
// `@Authz({ access: "public" })` as the SSOT the global guard, the completeness
// gate and the matrix all read, and a short `Cache-Control` because neither
// body varies per session — a guest and a logged-in doctor receive
// byte-for-byte the same page.
//
// They live in the taxonomy module rather than the events one because the
// relationship, not the event, is what they read: the query, the eligibility
// rule and the cursor all belong to `EventProjectsService`, and splitting one
// direction across two modules would leave the two halves of one contract
// maintained apart.
//
// Nest binds one path per controller class, and these are two different paths,
// so this file declares TWO classes. The param is named `:idOrSlug` to match
// the sibling public event route it shares a path prefix with.
//
// Visibility policy (§5.2), identical in both directions:
// - an unknown OR not-publicly-eligible source is 404, indistinguishable from
//   each other, so a draft leaks no "exists but private" oracle;
// - an eligible source with no eligible relations is an ordinary empty page,
//   never a 404 — "this event has no projects yet" is a fact, not an error.

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
export class EventProjectsPublicController {
  // Explicit @Inject token — the root-level authz gate boots this graph under
  // `tsx`, which emits no `design:paramtypes` (see `topics.service.ts`).
  constructor(
    @Inject(EventProjectsService)
    private readonly relations: EventProjectsService,
  ) {}

  /**
   * §5.2 — `GET /v1/public/events/:idOrSlug/projects`. The projects a
   * publish-visible event runs under, as exactly `PublicProjectSummary` rows,
   * cursor-paginated in a stable title order.
   */
  @Get(":idOrSlug/projects")
  @Public()
  @Header("Cache-Control", "public, max-age=30")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-6", "EARS-16"],
  })
  projects(
    @Param("idOrSlug") idOrSlug: string,
    @Query() rawQuery: Record<string, string>,
  ): Promise<PublicProjectSummaryPage> {
    return this.relations.publicProjectsForEvent(
      publicKey(idOrSlug),
      parseCursorQuery(rawQuery),
    );
  }
}

@Controller({ path: "public/projects", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class ProjectEventsPublicController {
  constructor(
    @Inject(EventProjectsService)
    private readonly relations: EventProjectsService,
  ) {}

  /**
   * §5.2 — `GET /v1/public/projects/:idOrSlug/events`. The reverse traversal:
   * the publish-visible events a published project carries, as exactly
   * `PublicEventSummary` rows, cursor-paginated by air date.
   */
  @Get(":idOrSlug/events")
  @Public()
  @Header("Cache-Control", "public, max-age=30")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-6", "EARS-16"],
  })
  events(
    @Param("idOrSlug") idOrSlug: string,
    @Query() rawQuery: Record<string, string>,
  ): Promise<PublicEventSummaryPage> {
    return this.relations.publicEventsForProject(
      publicKey(idOrSlug),
      parseCursorQuery(rawQuery),
    );
  }
}

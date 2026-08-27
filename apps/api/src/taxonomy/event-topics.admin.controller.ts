import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  CANONICAL_UUID_REGEX,
  CreateEventTopicRequestSchema,
  type EventTopicAdminList,
  EventTopicAdminListQuerySchema,
  IDEMPOTENCY_KEY_HEADER,
  IF_MATCH_HEADER,
  type LifecycleImpact,
  LIFECYCLE_IMPACT_TOKEN_HEADER,
  LifecycleImpactQuerySchema,
  parseIfMatchVersion,
  type TaxonomyLifecycleTransition,
} from "@ds/schemas";
import { Authz } from "../authz/index.js";
import { EventTopicsService } from "./event-topics.service.js";
import {
  type IdempotencyOutcome,
  IdempotencyService,
} from "./idempotency.service.js";
import { LifecycleImpactService } from "./lifecycle-impact.service.js";
import { TaxonomyError } from "./taxonomy.errors.js";
import { TaxonomyProblemFilter } from "./taxonomy.problem-filter.js";

// 012 EARS-11 (#1293) — the event↔topic relationship admin surface (012-design
// §5.1 + §3.1). The authorization contract is the one the entity verticals
// established, unchanged: feature 011's MFA-verified admin session plus CSRF
// double-submit, with the route guard requiring `platform_admin` BEFORE
// validation, idempotency or handler (EARS-16).
//
// There is deliberately NO `PATCH` route, for exactly the reason `event_projects`
// has none: `event_topics` carries no mutable attribute (012-design §2 ER: the
// row is exactly the pair plus its lifecycle envelope), unlike `project_experts`
// (`role`) or `project_partners` (`is_primary`). §5.1's "PATCH attributes with
// the join ETag" is a generic statement over the five joins and is vacuous for
// this one — a PATCH here could only accept an empty body and bump a version.
// The ETag / If-Match contract still applies in full: it rides the two lifecycle
// transitions.
//
// There is likewise no route, and no request field anywhere in this controller,
// that creates a topic: EARS-11's «no inline creation» is the absence of the
// seam, not a flag on it. An event is tagged by referencing a `topics` row that
// already exists, authored through its own #1285 vertical.
//
// Every relationship request carries JSON or nothing — a relationship has no
// media slot, so a non-JSON content type is 415 with no branch to mirror.

/** The §5.1 route templates, as the idempotency record stores them. */
const ROUTE_CREATE = "/v1/admin/event-topics";
const ROUTE_TRANSITION = "/v1/admin/event-topics/:id/:transition";
const SCOPE = "taxonomy.event-topics";

@Controller({ path: "admin/event-topics", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class EventTopicsAdminController {
  // Explicit @Inject tokens — see the note in `topics.service.ts`: the
  // root-level authz gate boots this graph under `tsx`, which emits no
  // `design:paramtypes`, so type-inferred injection resolves to `undefined`.
  constructor(
    @Inject(EventTopicsService)
    private readonly relations: EventTopicsService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(LifecycleImpactService)
    private readonly impact: LifecycleImpactService,
  ) {}

  /**
   * EARS-11 / EARS-15 — the relationship list. Either endpoint may scope it
   * (`eventId` / `topicId`), `status` filters explicitly, and retired
   * relationships are excluded unless asked for: a retained row that was
   * withdrawn is still addressable, it is simply not the default view.
   */
  @Get()
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-11", "EARS-15", "EARS-16"],
  })
  list(@Query() rawQuery: Record<string, string>): Promise<EventTopicAdminList> {
    const parsed = EventTopicAdminListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) throw validationFailed(parsed.error.issues, "query");
    return this.relations.list(parsed.data);
  }

  /**
   * EARS-11 — `POST /v1/admin/event-topics`. Tags one event with one EXISTING
   * topic. Requires a canonical UUID `Idempotency-Key`; there is no `If-Match`
   * because there is no prior version to assert. Answers 201 with the detail
   * body, the row's `ETag` and a `Location`.
   *
   * A pair that already exists ACTIVE is 409; a pair that exists RETIRED is
   * also 409, and says to restore it — creating a second row for the same pair
   * would break the retained-identity rule this whole vertical is built on.
   */
  @Post()
  @HttpCode(201)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    // #1304 (ADR-0001 §10): a state-changing admin command re-establishes the
    // role against the LIVE IdP before anything happens, so a revoked grant
    // cannot leave a half-written relationship behind. Reads keep it absent.
    revalidate: "live",
    // The domain audit row is written by feature 010's capture trigger inside
    // the command transaction (012-design §6), not by an authz-tier emission.
    audit: "low-stakes",
    tests: ["EARS-11", "EARS-16", "EARS-17"],
  })
  async create(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    // 1. Key shape — before any payload work (§5.1 failure order).
    const key = this.idempotency.requireKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
    // 2. Request shape + payload.
    const parsed = CreateEventTopicRequestSchema.safeParse(readJsonBody(req));
    if (!parsed.success) throw validationFailed(parsed.error.issues, "payload");
    // 3. Fingerprint binding.
    const outcome = await this.idempotency.begin({
      key,
      scope: SCOPE,
      actorId: actorSub(req),
      method: "POST",
      route: ROUTE_CREATE,
      fingerprint: this.idempotency.fingerprint({
        method: "POST",
        path: ROUTE_CREATE,
        payload: parsed.data,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;

    const { detail, etag } = await this.relations.create({
      payload: parsed.data,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    void reply.header("location", `${ROUTE_CREATE}/${detail.id}`);
    return detail;
  }

  /** EARS-11 — detail by stable id, retired relationships included (§5.1). */
  @Get(":id")
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-11", "EARS-16"],
  })
  async detail(
    @Param("id") id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    // A non-UUID token cannot address an admin row: the admin surface is
    // id-only, slugs belong to the public surface (§5.2).
    if (!CANONICAL_UUID_REGEX.test(id)) {
      throw new TaxonomyError("RESOURCE_NOT_FOUND");
    }
    const { detail, etag } = await this.relations.detail(id);
    void reply.header("etag", etag);
    return detail;
  }

  /**
   * EARS-11 / §3.1 — the lifecycle-impact PREVIEW. Answers what retiring (or
   * restoring) this relationship would change, and hands back the signed
   * `impactToken` that authorizes confirming exactly that transition against
   * exactly the set discovered here.
   *
   * A read, so no idempotency record and no live revalidation: it mutates
   * nothing, and the confirmation route is where the write posture applies.
   */
  @Get(":id/lifecycle-impact")
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-11", "EARS-16"],
  })
  lifecycleImpact(
    @Param("id") id: string,
    @Query() rawQuery: Record<string, string>,
  ): Promise<LifecycleImpact> {
    if (!CANONICAL_UUID_REGEX.test(id)) {
      throw new TaxonomyError("RESOURCE_NOT_FOUND");
    }
    const parsed = LifecycleImpactQuerySchema.safeParse(rawQuery);
    if (!parsed.success) throw validationFailed(parsed.error.issues, "query");
    return this.relations.lifecycleImpact(id, parsed.data.transition);
  }

  /** EARS-11 — withdraw the relationship, retaining its row and its id (§3.1). */
  @Post(":id/retire")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-11", "EARS-16", "EARS-17"],
  })
  retire(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    return this.confirmTransition("retire", id, req, reply);
  }

  /**
   * EARS-11 — put the SAME relationship back into effect. A restore is an
   * UPDATE of the retained row, never a re-insert: the id an audit trail
   * already cites keeps pointing at this relationship.
   */
  @Post(":id/restore")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-11", "EARS-16", "EARS-17"],
  })
  restore(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    return this.confirmTransition("restore", id, req, reply);
  }

  /**
   * The §3.1 confirmation contract, identical for both transitions and
   * therefore written once: the failure ORDER is part of the contract, not an
   * implementation detail.
   *
   *   idempotency key shape → If-Match presence → If-Match usability →
   *   impact-token presence → fingerprint binding → the SERIALIZABLE command.
   *
   * The impact token joins the idempotency fingerprint because two
   * confirmations that quote the same key but different previews are DIFFERENT
   * requests, and replaying one under the other's record would confirm a
   * transition against a set the caller never saw.
   */
  private async confirmTransition(
    transition: TaxonomyLifecycleTransition,
    id: string,
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<unknown> {
    if (!CANONICAL_UUID_REGEX.test(id)) {
      throw new TaxonomyError("RESOURCE_NOT_FOUND");
    }
    const key = this.idempotency.requireKey(req.headers[IDEMPOTENCY_KEY_HEADER]);

    const rawIfMatch = req.headers[IF_MATCH_HEADER] as string | undefined;
    if (!rawIfMatch || rawIfMatch.trim().length === 0) {
      throw new TaxonomyError(
        "PRECONDITION_REQUIRED",
        "a lifecycle transition must carry the If-Match of the version it was previewed at",
      );
    }
    const expectedVersion = parseIfMatchVersion(rawIfMatch);
    if (expectedVersion === null) {
      // A syntactically unusable validator asserts nothing, so it cannot pass:
      // treat it as the failed precondition it is, never as "no precondition".
      throw new TaxonomyError(
        "PRECONDITION_FAILED",
        "the If-Match validator is not one this API issued",
      );
    }

    // 428 `LIFECYCLE_IMPACT_REQUIRED` when absent — the operator must have SEEN
    // the consequences before confirming them (§3.1); a transition is never
    // available as a one-shot call.
    const impactToken = this.impact.requireToken(
      req.headers[LIFECYCLE_IMPACT_TOKEN_HEADER],
    );

    const path = `/v1/admin/event-topics/${id}/${transition}`;
    const outcome = await this.idempotency.begin({
      key,
      scope: SCOPE,
      actorId: actorSub(req),
      method: "POST",
      route: ROUTE_TRANSITION,
      fingerprint: this.idempotency.fingerprint({
        method: "POST",
        path,
        payload: { transition },
        ifMatch: rawIfMatch,
        lifecycleImpactToken: impactToken,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;

    const { detail, etag } = await this.relations.transition({
      id,
      transition,
      expectedVersion,
      impactToken,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    return detail;
  }
}

/** One `VALIDATION_FAILED` shape for both the query and the payload boundary. */
function validationFailed(
  issues: readonly {
    path: readonly (string | number | symbol)[];
    message: string;
  }[],
  what: "query" | "payload",
): TaxonomyError {
  return new TaxonomyError(
    "VALIDATION_FAILED",
    what === "query"
      ? "invalid relationship query"
      : "invalid relationship payload",
    issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
  );
}

/**
 * A relationship carries no media slot at all, so anything that is not JSON is
 * 415 — not "an upload in the wrong place" but a shape that could never be
 * satisfied, because there is no file part name to accept.
 */
function readJsonBody(req: FastifyRequest): unknown {
  const contentType = String(req.headers["content-type"] ?? "");
  if (contentType && !contentType.includes("application/json")) {
    throw new TaxonomyError(
      "UNSUPPORTED_MEDIA_TYPE",
      "a relationship carries no media; use application/json",
    );
  }
  return req.body;
}

/**
 * Replay a completed record's stored outcome verbatim (§6): the exact status,
 * body and allow-listed `ETag`/`Location`.
 */
function replayed(
  outcome: IdempotencyOutcome,
  reply: FastifyReply,
): outcome is Extract<IdempotencyOutcome, { kind: "replay" }> {
  if (outcome.kind !== "replay") return false;
  void reply.status(outcome.replay.status);
  if (outcome.replay.etag) void reply.header("etag", outcome.replay.etag);
  if (outcome.replay.location) {
    void reply.header("location", outcome.replay.location);
  }
  return true;
}

/** The acting admin's subject — the actor half of the record's identity binding. */
function actorSub(req: FastifyRequest): string | null {
  return (req as { user?: { sub?: string } }).user?.sub ?? null;
}

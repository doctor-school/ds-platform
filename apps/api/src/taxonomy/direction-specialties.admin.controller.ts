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
  CreateDirectionSpecialtyRequestSchema,
  type DirectionSpecialtyAdminList,
  DirectionSpecialtyAdminListQuerySchema,
  IDEMPOTENCY_KEY_HEADER,
  type TaxonomyLifecycleTransition,
} from "@ds/schemas";
import { Authz } from "../authz/index.js";
import { DirectionSpecialtiesService } from "./direction-specialties.service.js";
import {
  actorSub,
  readJsonBody,
  replayed,
  requireIfMatchVersion,
  validationFailed,
} from "./direction-relations.http.js";
import { IdempotencyService } from "./idempotency.service.js";
import { TaxonomyError } from "./taxonomy.errors.js";
import { TaxonomyProblemFilter } from "./taxonomy.problem-filter.js";

// #1483 (ADR-0016 §2.8, 017-design §5) — the direction↔specialty admin surface.
// The authorization contract is the one the 012 verticals established, copied
// unchanged: feature 011's MFA-verified admin session plus CSRF double-submit,
// with the route guard requiring `platform_admin` BEFORE validation, idempotency
// or handler, and `revalidate: "live"` on every state-changing command (#1304).
//
// There is deliberately NO `PATCH` route. The link carries no mutable attribute
// (it is exactly the pair plus its lifecycle envelope), the same reasoning
// `event_projects` records: a PATCH here could only accept an empty body and
// bump a version. The ETag / If-Match contract still applies in full — it rides
// the two lifecycle transitions.

const ROUTE_CREATE = "/v1/admin/direction-specialties";
const ROUTE_TRANSITION = "/v1/admin/direction-specialties/:id/:transition";
const SCOPE = "taxonomy.direction-specialties";

@Controller({ path: "admin/direction-specialties", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class DirectionSpecialtiesAdminController {
  // Explicit @Inject tokens — see the note in `directions.service.ts`: the
  // root-level authz gate boots this graph under `tsx`, which emits no
  // `design:paramtypes`, so type-inferred injection resolves to `undefined`.
  constructor(
    @Inject(DirectionSpecialtiesService)
    private readonly links: DirectionSpecialtiesService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * The link list. Either endpoint may scope it (`directionId` /
   * `specialtyMinzdravId`), `status` filters explicitly, and retired links are
   * excluded unless asked for: a retained row that was withdrawn is still
   * addressable, it is simply not the default view.
   */
  @Get()
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-8"],
  })
  list(
    @Query() rawQuery: Record<string, string>,
  ): Promise<DirectionSpecialtyAdminList> {
    const parsed = DirectionSpecialtyAdminListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) throw validationFailed(parsed.error.issues, "query");
    return this.links.list(parsed.data);
  }

  /**
   * `POST /v1/admin/direction-specialties` — state that a direction serves one
   * entry of the closed Минздрав book. Requires a canonical UUID
   * `Idempotency-Key`; there is no `If-Match` because there is no prior version
   * to assert. Answers 201 with the detail body, the row's `ETag` and a
   * `Location`.
   *
   * A pair that already exists ACTIVE is 409; a pair that exists RETIRED is also
   * 409, and says to restore it — creating a second row for the same pair would
   * break the retained-identity rule.
   */
  @Post()
  @HttpCode(201)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    // #1304 (ADR-0001 §10): a state-changing admin command re-establishes the
    // role against the LIVE IdP before anything happens, so a revoked grant
    // cannot leave a half-written link behind. Reads keep it absent.
    revalidate: "live",
    // The domain audit row is written by feature 010's capture trigger inside
    // the command transaction, not by an authz-tier emission.
    audit: "low-stakes",
    tests: ["EARS-8"],
  })
  async create(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    // 1. Key shape — before any payload work (§5.1 failure order).
    const key = this.idempotency.requireKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
    // 2. Request shape + payload.
    const parsed = CreateDirectionSpecialtyRequestSchema.safeParse(
      readJsonBody(req),
    );
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

    const { detail, etag } = await this.links.create({
      payload: parsed.data,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    void reply.header("location", `${ROUTE_CREATE}/${detail.id}`);
    return detail;
  }

  /** Detail by stable id, retired links included. */
  @Get(":id")
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-8"],
  })
  async detail(
    @Param("id") id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    // A non-UUID token cannot address an admin row: the admin surface is
    // id-only, slugs belong to the public surface.
    if (!CANONICAL_UUID_REGEX.test(id)) {
      throw new TaxonomyError("RESOURCE_NOT_FOUND");
    }
    const { detail, etag } = await this.links.detail(id);
    void reply.header("etag", etag);
    return detail;
  }

  /** Withdraw the link, retaining its row and its id. */
  @Post(":id/retire")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-8"],
  })
  retire(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    return this.confirmTransition("retire", id, req, reply);
  }

  /**
   * Put the SAME link back into effect. A restore is an UPDATE of the retained
   * row, never a re-insert: the id an audit trail already cites keeps pointing
   * at this link.
   */
  @Post(":id/restore")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-8"],
  })
  restore(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    return this.confirmTransition("restore", id, req, reply);
  }

  /**
   * Both transitions share one contract, so it is written once: the failure
   * ORDER is part of it, not an implementation detail.
   *
   *   idempotency key shape → If-Match presence → If-Match usability →
   *   fingerprint binding → the domain transaction.
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
    const ifMatch = requireIfMatchVersion(req, "a lifecycle transition");

    const path = `/v1/admin/direction-specialties/${id}/${transition}`;
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
        ifMatch: ifMatch.raw,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;

    const { detail, etag } = await this.links.transition({
      id,
      transition,
      expectedVersion: ifMatch.version,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    return detail;
  }
}

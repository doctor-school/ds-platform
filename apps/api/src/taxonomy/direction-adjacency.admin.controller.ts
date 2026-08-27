import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  CANONICAL_UUID_REGEX,
  CreateDirectionAdjacencyRequestSchema,
  type DirectionAdjacencyAdminList,
  DirectionAdjacencyAdminListQuerySchema,
  IDEMPOTENCY_KEY_HEADER,
  type TaxonomyLifecycleTransition,
  UpdateDirectionAdjacencyRequestSchema,
} from "@ds/schemas";
import { Authz } from "../authz/index.js";
import { DirectionAdjacencyService } from "./direction-adjacency.service.js";
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

// #1483 (ADR-0016 §2.8, 017-design §5) — the direction-adjacency admin surface.
// Same authorization contract as every other taxonomy admin surface: feature
// 011's MFA-verified admin session plus CSRF double-submit, `platform_admin`
// enforced by the route guard BEFORE validation or the idempotency reservation,
// and `revalidate: "live"` on every state-changing command (#1304).
//
// Unlike the 012 joins this relation DOES carry attributes (`kind`, `weight`),
// so `PATCH :id` is a real surface rather than a vacuous one. The endpoints are
// the edge's identity and are therefore NOT patchable — moving an edge is
// retiring one and authoring another.

const ROUTE_CREATE = "/v1/admin/direction-adjacency";
const ROUTE_UPDATE = "/v1/admin/direction-adjacency/:id";
const ROUTE_TRANSITION = "/v1/admin/direction-adjacency/:id/:transition";
const SCOPE = "taxonomy.direction-adjacency";

@Controller({ path: "admin/direction-adjacency", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class DirectionAdjacencyAdminController {
  constructor(
    @Inject(DirectionAdjacencyService)
    private readonly edges: DirectionAdjacencyService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * The edge list. Either END may scope it — `directionId` answers «что рядом с
   * этим направлением», `adjacentDirectionId` the reverse question a directed
   * edge makes askable — and retired edges are excluded unless asked for.
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
  ): Promise<DirectionAdjacencyAdminList> {
    const parsed = DirectionAdjacencyAdminListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) throw validationFailed(parsed.error.issues, "query");
    return this.edges.list(parsed.data);
  }

  /**
   * `POST /v1/admin/direction-adjacency` — author one DIRECTED edge. The
   * ordered pair is the edge's identity: an existing pair is 409 (restore or
   * edit it), while the REVERSE pair is a different edge and is authored
   * separately.
   */
  @Post()
  @HttpCode(201)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-8"],
  })
  async create(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const key = this.idempotency.requireKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
    const parsed = CreateDirectionAdjacencyRequestSchema.safeParse(
      readJsonBody(req),
    );
    if (!parsed.success) throw validationFailed(parsed.error.issues, "payload");
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

    const { detail, etag } = await this.edges.create({
      payload: parsed.data,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    void reply.header("location", `${ROUTE_CREATE}/${detail.id}`);
    return detail;
  }

  /** Detail by stable id, retired edges included. */
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
    if (!CANONICAL_UUID_REGEX.test(id)) {
      throw new TaxonomyError("RESOURCE_NOT_FOUND");
    }
    const { detail, etag } = await this.edges.detail(id);
    void reply.header("etag", etag);
    return detail;
  }

  /**
   * `PATCH /v1/admin/direction-adjacency/:id` — re-label or re-weight the SAME
   * edge, under the If-Match version it was read at.
   */
  @Patch(":id")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-8"],
  })
  async update(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    if (!CANONICAL_UUID_REGEX.test(id)) {
      throw new TaxonomyError("RESOURCE_NOT_FOUND");
    }
    const key = this.idempotency.requireKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
    const ifMatch = requireIfMatchVersion(req, "an edit");
    const parsed = UpdateDirectionAdjacencyRequestSchema.safeParse(
      readJsonBody(req),
    );
    if (!parsed.success) throw validationFailed(parsed.error.issues, "payload");

    const path = `/v1/admin/direction-adjacency/${id}`;
    const outcome = await this.idempotency.begin({
      key,
      scope: SCOPE,
      actorId: actorSub(req),
      method: "PATCH",
      route: ROUTE_UPDATE,
      fingerprint: this.idempotency.fingerprint({
        method: "PATCH",
        path,
        payload: parsed.data,
        ifMatch: ifMatch.raw,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;

    const { detail, etag } = await this.edges.update({
      id,
      payload: parsed.data,
      expectedVersion: ifMatch.version,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    return detail;
  }

  /** Withdraw the edge, retaining its row and its id. */
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

  /** Put the SAME edge back into effect — an UPDATE, never a re-insert. */
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
   * One contract for both transitions; the failure ORDER is part of it:
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

    const path = `/v1/admin/direction-adjacency/${id}/${transition}`;
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

    const { detail, etag } = await this.edges.transition({
      id,
      transition,
      expectedVersion: ifMatch.version,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    return detail;
  }
}

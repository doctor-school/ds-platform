import {
  Controller,
  Get,
  Header,
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
  AdminTaxonomyListQuerySchema,
  CANONICAL_UUID_REGEX,
  CreateEventKindRequestSchema,
  type EventKindAdminList,
  IDEMPOTENCY_KEY_HEADER,
  IF_MATCH_HEADER,
  type LifecycleImpact,
  LIFECYCLE_IMPACT_TOKEN_HEADER,
  LifecycleImpactQuerySchema,
  parseIfMatchVersion,
  type PublicEventKindList,
  type TaxonomyLifecycleTransition,
  UpdateEventKindRequestSchema,
} from "@ds/schemas";
import { Authz, Public } from "../authz/index.js";
import {
  type IdempotencyOutcome,
  IdempotencyService,
} from "./idempotency.service.js";
import { LifecycleImpactService } from "./lifecycle-impact.service.js";
import { TaxonomyError } from "./taxonomy.errors.js";
import { TaxonomyProblemFilter } from "./taxonomy.problem-filter.js";
import { EventKindsService } from "./event-kinds.service.js";

// 012 EARS-25…28 (#2509) — the event-kind dictionary admin surface, the same
// contract as the direction vertical (012-design §5.1): feature 011's MFA admin
// session + CSRF, `platform_admin` required before validation, idempotency or
// handler; JSON only (a kind has no media); retire/restore gated by the §3.1
// lifecycle-impact preview. There is no Delete route.

const SCOPE = "taxonomy.event-kinds";
const BASE = "/v1/admin/event-kinds";

@Controller({ path: "admin/event-kinds", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class EventKindsAdminController {
  constructor(
    @Inject(EventKindsService) private readonly kinds: EventKindsService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(LifecycleImpactService)
    private readonly impact: LifecycleImpactService,
  ) {}

  /** EARS-25 — the shared admin list (offset pages, LD-6 search, status filter). */
  @Get()
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-25"],
  })
  list(@Query() rawQuery: Record<string, string>): Promise<EventKindAdminList> {
    const parsed = AdminTaxonomyListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw validation("invalid list query", parsed.error.issues);
    }
    return this.kinds.list(parsed.data);
  }

  /** EARS-25 — create one draft kind; slug server-derived. */
  @Post()
  @HttpCode(201)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-25"],
  })
  async create(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const key = this.idempotency.requireKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
    const parsed = CreateEventKindRequestSchema.safeParse(
      readJsonBody(req, false),
    );
    if (!parsed.success) {
      throw validation("invalid event kind payload", parsed.error.issues);
    }
    const outcome = await this.idempotency.begin({
      key,
      scope: SCOPE,
      actorId: actorSub(req),
      method: "POST",
      route: BASE,
      fingerprint: this.idempotency.fingerprint({
        method: "POST",
        path: BASE,
        payload: parsed.data,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;

    const { detail, etag } = await this.kinds.create({
      payload: parsed.data,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    void reply.header("location", `${BASE}/${detail.id}`);
    return detail;
  }

  /** EARS-25 — detail by stable id, retired rows included. */
  @Get(":id")
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-25"],
  })
  async detail(
    @Param("id") id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    requireUuid(id);
    const { detail, etag } = await this.kinds.detail(id);
    void reply.header("etag", etag);
    return detail;
  }

  /** EARS-25 — rename or re-scope the SAME row; a narrowing that would strand an event is refused. */
  @Patch(":id")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-25", "EARS-26"],
  })
  async update(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    requireUuid(id);
    const key = this.idempotency.requireKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
    const { raw: rawIfMatch, version: expectedVersion } = requireVersion(
      req,
      "an edit",
    );
    const parsed = UpdateEventKindRequestSchema.safeParse(
      readJsonBody(req, true),
    );
    if (!parsed.success) {
      throw validation("invalid event kind payload", parsed.error.issues);
    }
    const outcome = await this.idempotency.begin({
      key,
      scope: SCOPE,
      actorId: actorSub(req),
      method: "PATCH",
      route: `${BASE}/:id`,
      fingerprint: this.idempotency.fingerprint({
        method: "PATCH",
        path: `${BASE}/${id}`,
        payload: parsed.data,
        ifMatch: rawIfMatch,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;

    const { detail, etag } = await this.kinds.update({
      id,
      payload: parsed.data,
      expectedVersion,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    return detail;
  }

  /** EARS-28 — `draft → published`; additive, so no impact envelope. */
  @Post(":id/publish")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-28"],
  })
  async publish(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    requireUuid(id);
    const key = this.idempotency.requireKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
    const { raw: rawIfMatch, version: expectedVersion } = requireVersion(
      req,
      "a publish",
    );
    const outcome = await this.idempotency.begin({
      key,
      scope: SCOPE,
      actorId: actorSub(req),
      method: "POST",
      route: `${BASE}/:id/publish`,
      fingerprint: this.idempotency.fingerprint({
        method: "POST",
        path: `${BASE}/${id}/publish`,
        payload: {},
        ifMatch: rawIfMatch,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;

    const { detail, etag } = await this.kinds.publish({
      id,
      expectedVersion,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    return detail;
  }

  /** EARS-28 — the §3.1 preview of a retire / restore. */
  @Get(":id/lifecycle-impact")
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-28"],
  })
  lifecycleImpact(
    @Param("id") id: string,
    @Query() rawQuery: Record<string, string>,
  ): Promise<LifecycleImpact> {
    requireUuid(id);
    const parsed = LifecycleImpactQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw validation("invalid lifecycle-impact query", parsed.error.issues);
    }
    return this.kinds.lifecycleImpact(id, parsed.data.transition);
  }

  /** EARS-28 — withdraw the kind; every event keeps its reference. */
  @Post(":id/retire")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-28"],
  })
  retire(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    return this.confirmTransition("retire", id, req, reply);
  }

  /** EARS-28 — put the SAME kind back in hand, as a `draft`. */
  @Post(":id/restore")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-28"],
  })
  restore(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    return this.confirmTransition("restore", id, req, reply);
  }

  /** Same failure order as the direction vertical's confirmation. */
  private async confirmTransition(
    transition: TaxonomyLifecycleTransition,
    id: string,
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<unknown> {
    requireUuid(id);
    const key = this.idempotency.requireKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
    const { raw: rawIfMatch, version: expectedVersion } = requireVersion(
      req,
      "a lifecycle transition",
      "previewed",
    );
    const impactToken = this.impact.requireToken(
      req.headers[LIFECYCLE_IMPACT_TOKEN_HEADER],
    );
    const outcome = await this.idempotency.begin({
      key,
      scope: SCOPE,
      actorId: actorSub(req),
      method: "POST",
      route: `${BASE}/:id/${transition}`,
      fingerprint: this.idempotency.fingerprint({
        method: "POST",
        path: `${BASE}/${id}/${transition}`,
        payload: { impactToken },
        ifMatch: rawIfMatch,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;

    const { detail, etag } = await this.kinds.transition({
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

/**
 * EARS-28 — `GET /v1/public/event-kinds`: every published, non-retired kind as
 * `PublicEventKind { id, slug, title }`. The same body for a guest and a
 * logged-in reader, so a short shared cache.
 */
@Controller({ path: "public/event-kinds", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class EventKindsPublicController {
  constructor(
    @Inject(EventKindsService) private readonly kinds: EventKindsService,
  ) {}

  @Get()
  @Public()
  @Header("Cache-Control", "public, max-age=30")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-28"],
  })
  list(): Promise<PublicEventKindList> {
    return this.kinds.listPublic();
  }
}

function requireUuid(id: string): void {
  if (!CANONICAL_UUID_REGEX.test(id)) {
    throw new TaxonomyError("RESOURCE_NOT_FOUND");
  }
}

function validation(
  message: string,
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
): TaxonomyError {
  return new TaxonomyError(
    "VALIDATION_FAILED",
    message,
    issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  );
}

function requireVersion(
  req: FastifyRequest,
  what: string,
  read: "read" | "previewed" = "read",
): { raw: string; version: number } {
  const raw = req.headers[IF_MATCH_HEADER] as string | undefined;
  if (!raw || raw.trim().length === 0) {
    throw new TaxonomyError(
      "PRECONDITION_REQUIRED",
      `${what} must carry the If-Match of the version it was ${read} at`,
    );
  }
  const version = parseIfMatchVersion(raw);
  if (version === null) {
    throw new TaxonomyError(
      "PRECONDITION_FAILED",
      "the If-Match validator is not one this API issued",
    );
  }
  return { raw, version };
}

function readJsonBody(req: FastifyRequest, bodyOptional: boolean): unknown {
  const contentType = String(req.headers["content-type"] ?? "");
  if (contentType && !contentType.includes("application/json")) {
    throw new TaxonomyError(
      "UNSUPPORTED_MEDIA_TYPE",
      "an event kind carries no media; use application/json",
    );
  }
  return req.body ?? (bodyOptional ? {} : undefined);
}

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

function actorSub(req: FastifyRequest): string | null {
  return (req as { user?: { sub?: string } }).user?.sub ?? null;
}

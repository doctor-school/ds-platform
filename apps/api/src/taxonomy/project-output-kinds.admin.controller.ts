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
  CreateProjectOutputKindRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IF_MATCH_HEADER,
  parseIfMatchVersion,
  type ProjectOutputKindAdminList,
  ProjectOutputKindAdminListQuerySchema,
  UpdateProjectOutputKindRequestSchema,
} from "@ds/schemas";
import { Authz } from "../authz/index.js";
import {
  type IdempotencyOutcome,
  IdempotencyService,
} from "./idempotency.service.js";
import { ProjectOutputKindsService } from "./project-output-kinds.service.js";
import { TaxonomyError } from "./taxonomy.errors.js";
import { TaxonomyProblemFilter } from "./taxonomy.problem-filter.js";

// 030 EARS-3 / EARS-18 (#3503) — the «Виды результатов» admin surface, the same
// contract as every taxonomy dictionary (012-design §5.1): feature 011's MFA
// admin session + CSRF, `platform_admin` required before validation,
// idempotency or handler; JSON only; every write after create under `If-Match`.

const SCOPE = "taxonomy.project-output-kinds";
const BASE = "/v1/admin/project-output-kinds";

@Controller({ path: "admin/project-output-kinds", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class ProjectOutputKindsAdminController {
  constructor(
    @Inject(ProjectOutputKindsService)
    private readonly kinds: ProjectOutputKindsService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  /** EARS-3 — every kind with its status and result count; `?status=active` feeds the results editor. */
  @Get()
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-3", "EARS-18"],
  })
  list(
    @Query() rawQuery: Record<string, string>,
  ): Promise<ProjectOutputKindAdminList> {
    const parsed = ProjectOutputKindAdminListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw validation("invalid list query", parsed.error.issues);
    }
    return this.kinds.list(parsed.data);
  }

  /** EARS-3 — add a kind; slug server-derived. */
  @Post()
  @HttpCode(201)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-3", "EARS-18"],
  })
  async create(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const key = this.idempotency.requireKey(
      req.headers[IDEMPOTENCY_KEY_HEADER],
    );
    const parsed = CreateProjectOutputKindRequestSchema.safeParse(
      readJsonBody(req),
    );
    if (!parsed.success) {
      throw validation("invalid output kind payload", parsed.error.issues);
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

  /** EARS-3 — rename the SAME row; id and slug stay. */
  @Patch(":id")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-3", "EARS-18"],
  })
  async update(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    requireUuid(id);
    const key = this.idempotency.requireKey(
      req.headers[IDEMPOTENCY_KEY_HEADER],
    );
    const { raw: rawIfMatch, version: expectedVersion } = requireVersion(
      req,
      "a rename",
    );
    const parsed = UpdateProjectOutputKindRequestSchema.safeParse(
      readJsonBody(req),
    );
    if (!parsed.success) {
      throw validation("invalid output kind payload", parsed.error.issues);
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

  /** EARS-3 — retire; refused with `409 OUTPUT_KIND_IN_USE` while a draft/published project holds it. */
  @Post(":id/retire")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-3", "EARS-18"],
  })
  retire(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    return this.transition(id, "retire", req, reply);
  }

  /** EARS-3 — restore a retired kind as active under the same id. */
  @Post(":id/restore")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-3", "EARS-18"],
  })
  restore(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    return this.transition(id, "restore", req, reply);
  }

  private async transition(
    id: string,
    verb: "retire" | "restore",
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<unknown> {
    requireUuid(id);
    const key = this.idempotency.requireKey(
      req.headers[IDEMPOTENCY_KEY_HEADER],
    );
    const { raw: rawIfMatch, version: expectedVersion } = requireVersion(
      req,
      `a ${verb}`,
    );
    const outcome = await this.idempotency.begin({
      key,
      scope: SCOPE,
      actorId: actorSub(req),
      method: "POST",
      route: `${BASE}/:id/${verb}`,
      fingerprint: this.idempotency.fingerprint({
        method: "POST",
        path: `${BASE}/${id}/${verb}`,
        payload: {},
        ifMatch: rawIfMatch,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;

    const input = { id, expectedVersion, lease: outcome.lease };
    const { detail, etag } =
      verb === "retire"
        ? await this.kinds.retire(input)
        : await this.kinds.restore(input);
    void reply.header("etag", etag);
    return detail;
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
): { raw: string; version: number } {
  const raw = req.headers[IF_MATCH_HEADER] as string | undefined;
  if (!raw || raw.trim().length === 0) {
    throw new TaxonomyError(
      "PRECONDITION_REQUIRED",
      `${what} must carry the If-Match of the version it was read at`,
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

function readJsonBody(req: FastifyRequest): unknown {
  const contentType = String(req.headers["content-type"] ?? "");
  if (contentType && !contentType.includes("application/json")) {
    throw new TaxonomyError(
      "UNSUPPORTED_MEDIA_TYPE",
      "an output kind carries no media; use application/json",
    );
  }
  return req.body;
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

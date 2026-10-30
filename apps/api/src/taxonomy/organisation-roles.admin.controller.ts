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
  CreateOrganisationRoleRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IF_MATCH_HEADER,
  type OrganisationRoleAdminList,
  OrganisationRoleAdminListQuerySchema,
  parseIfMatchVersion,
  UpdateOrganisationRoleRequestSchema,
} from "@ds/schemas";
import { Authz } from "../authz/index.js";
import {
  type IdempotencyOutcome,
  IdempotencyService,
} from "./idempotency.service.js";
import { OrganisationRolesService } from "./organisation-roles.service.js";
import { TaxonomyError } from "./taxonomy.errors.js";
import { TaxonomyProblemFilter } from "./taxonomy.problem-filter.js";

// 032 EARS-3 / EARS-13 (#3492) — the organisation-role reference book admin
// surface, the same contract as every taxonomy dictionary (012-design §5.1):
// feature 011's MFA admin session + CSRF, `platform_admin` required before
// validation, idempotency or handler; JSON only; renames under `If-Match`.
// There is no Delete route; retire / restore (EARS-4) ride their own slice.

const SCOPE = "taxonomy.organisation-roles";
const BASE = "/v1/admin/organisation-roles";

@Controller({ path: "admin/organisation-roles", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class OrganisationRolesAdminController {
  constructor(
    @Inject(OrganisationRolesService)
    private readonly roles: OrganisationRolesService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  /** EARS-3 — the whole book with holder counts; `?status=active` feeds the organisation form. */
  @Get()
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-3", "EARS-13"],
  })
  list(
    @Query() rawQuery: Record<string, string>,
  ): Promise<OrganisationRoleAdminList> {
    const parsed = OrganisationRoleAdminListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw validation("invalid list query", parsed.error.issues);
    }
    return this.roles.list(parsed.data);
  }

  /** EARS-3 — «Добавить роль»; slug server-derived. */
  @Post()
  @HttpCode(201)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-3", "EARS-13"],
  })
  async create(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const key = this.idempotency.requireKey(
      req.headers[IDEMPOTENCY_KEY_HEADER],
    );
    const parsed = CreateOrganisationRoleRequestSchema.safeParse(
      readJsonBody(req),
    );
    if (!parsed.success) {
      throw validation(
        "invalid organisation role payload",
        parsed.error.issues,
      );
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

    const { detail, etag } = await this.roles.create({
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
    tests: ["EARS-3", "EARS-13"],
  })
  async update(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    if (!CANONICAL_UUID_REGEX.test(id)) {
      throw new TaxonomyError("RESOURCE_NOT_FOUND");
    }
    const key = this.idempotency.requireKey(
      req.headers[IDEMPOTENCY_KEY_HEADER],
    );
    const { raw: rawIfMatch, version: expectedVersion } = requireVersion(req);
    const parsed = UpdateOrganisationRoleRequestSchema.safeParse(
      readJsonBody(req),
    );
    if (!parsed.success) {
      throw validation(
        "invalid organisation role payload",
        parsed.error.issues,
      );
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

    const { detail, etag } = await this.roles.update({
      id,
      payload: parsed.data,
      expectedVersion,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    return detail;
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

function requireVersion(req: FastifyRequest): { raw: string; version: number } {
  const raw = req.headers[IF_MATCH_HEADER] as string | undefined;
  if (!raw || raw.trim().length === 0) {
    throw new TaxonomyError(
      "PRECONDITION_REQUIRED",
      "a rename must carry the If-Match of the version it was read at",
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
      "an organisation role carries no media; use application/json",
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

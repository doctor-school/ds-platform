import {
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
} from "@nestjs/common";
import { ApiBody, ApiCreatedResponse, ApiOkResponse } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createZodDto } from "nestjs-zod";
import {
  AdminApplicationDetailSchema,
  AdminApplicationListPageSchema,
  AdminApplicationNoteSchema,
  AdminApplicationListQuerySchema,
  type AdminApplicationListPage,
  AdminApplicationNoteCreateSchema,
  AdminApplicationStatusMoveSchema,
  CANONICAL_UUID_REGEX,
  IDEMPOTENCY_KEY_HEADER,
  IF_MATCH_HEADER,
  parseIfMatchVersion,
} from "@ds/schemas";

import { Authz } from "../authz/index.js";
import {
  type IdempotencyOutcome,
  IdempotencyService,
} from "../taxonomy/idempotency.service.js";
import { TaxonomyError } from "../taxonomy/taxonomy.errors.js";
import { ApplicationAdminProblemFilter } from "./applications.admin.errors.js";
import { ApplicationsAdminService } from "./applications.admin.service.js";

// 033 EARS-13…EARS-17, EARS-20 (#4030) — the admin «Заявки» surface over the
// shared application queue (033-design «Endpoints»). The 011 admin session
// with the second factor + CSRF and `platform_admin` are enforced by the
// global admin guards before validation, idempotency or handler; every
// mutation carries a canonical `Idempotency-Key`, the status move also the
// `If-Match` version (012 EARS-17); the 010 trigger records each change under
// the acting administrator. Per-operator reads ⇒ `no-store`.

export class AdminApplicationListPageDto extends createZodDto(
  AdminApplicationListPageSchema,
) {}
export class AdminApplicationDetailDto extends createZodDto(
  AdminApplicationDetailSchema,
) {}
export class AdminApplicationNoteDto extends createZodDto(
  AdminApplicationNoteSchema,
) {}
export class AdminApplicationStatusMoveDto extends createZodDto(
  AdminApplicationStatusMoveSchema,
) {}
export class AdminApplicationNoteCreateDto extends createZodDto(
  AdminApplicationNoteCreateSchema,
) {}

const SCOPE = "applications.admin";
const BASE = "/v1/admin/applications";

@Controller({ path: "admin/applications", version: "1" })
@UseFilters(ApplicationAdminProblemFilter)
export class ApplicationsAdminController {
  constructor(
    @Inject(ApplicationsAdminService)
    private readonly queue: ApplicationsAdminService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  /** EARS-13 — the queue list, newest first, kind/status filters, cursor paging. */
  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: AdminApplicationListPageDto })
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-13", "EARS-17"],
  })
  list(
    @Query() rawQuery: Record<string, string>,
  ): Promise<AdminApplicationListPage> {
    const parsed = AdminApplicationListQuerySchema.safeParse(rawQuery);
    if (!parsed.success)
      throw validation("invalid list query", parsed.error.issues);
    return this.queue.list(parsed.data);
  }

  /** EARS-14 — the detail with notes; `ETag` carries the version. */
  @Get(":id")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: AdminApplicationDetailDto })
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-14", "EARS-17"],
  })
  async detail(
    @Param("id") id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    requireId(id);
    const { detail, etag } = await this.queue.detail(id);
    void reply.header("etag", etag);
    return detail;
  }

  /** EARS-15 — move the status (with the outcome when closing) under If-Match. */
  @Post(":id/status")
  @HttpCode(200)
  @ApiBody({ type: AdminApplicationStatusMoveDto })
  @ApiOkResponse({ type: AdminApplicationDetailDto })
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-15", "EARS-17"],
  })
  async moveStatus(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    requireId(id);
    const key = this.idempotency.requireKey(
      req.headers[IDEMPOTENCY_KEY_HEADER],
    );
    const { raw: rawIfMatch, version } = requireVersion(req);
    const parsed = AdminApplicationStatusMoveSchema.safeParse(
      readJsonBody(req),
    );
    if (!parsed.success)
      throw validation("invalid status move", parsed.error.issues);
    const outcome = await this.begin(req, key, `${BASE}/:id/status`, {
      path: `${BASE}/${id}/status`,
      payload: parsed.data,
      ifMatch: rawIfMatch,
    });
    if (replayed(outcome, reply)) return outcome.replay.body;
    const { detail, etag } = await this.queue.moveStatus({
      id,
      move: parsed.data,
      expectedVersion: version,
      actorSub: actorSub(req),
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    return detail;
  }

  /** EARS-16 — append one immutable internal note. */
  @Post(":id/notes")
  @HttpCode(201)
  @ApiBody({ type: AdminApplicationNoteCreateDto })
  @ApiCreatedResponse({ type: AdminApplicationNoteDto })
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-16", "EARS-17"],
  })
  async addNote(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    requireId(id);
    const key = this.idempotency.requireKey(
      req.headers[IDEMPOTENCY_KEY_HEADER],
    );
    const parsed = AdminApplicationNoteCreateSchema.safeParse(
      readJsonBody(req),
    );
    if (!parsed.success) throw validation("invalid note", parsed.error.issues);
    const outcome = await this.begin(req, key, `${BASE}/:id/notes`, {
      path: `${BASE}/${id}/notes`,
      payload: parsed.data,
    });
    if (replayed(outcome, reply)) return outcome.replay.body;
    return this.queue.addNote({
      id,
      body: parsed.data.body,
      actorSub: actorSub(req),
      lease: outcome.lease,
    });
  }

  /** EARS-20 — «Стереть персональные данные заявителя»; a second call is 409. */
  @Post(":id/erase-personal-data")
  @HttpCode(200)
  @ApiOkResponse({ type: AdminApplicationDetailDto })
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-20", "EARS-17"],
  })
  async erase(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    requireId(id);
    const key = this.idempotency.requireKey(
      req.headers[IDEMPOTENCY_KEY_HEADER],
    );
    const outcome = await this.begin(
      req,
      key,
      `${BASE}/:id/erase-personal-data`,
      { path: `${BASE}/${id}/erase-personal-data`, payload: null },
    );
    if (replayed(outcome, reply)) return outcome.replay.body;
    const { detail, etag } = await this.queue.erase({
      id,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    return detail;
  }

  private begin(
    req: FastifyRequest,
    key: string,
    route: string,
    input: { path: string; payload: unknown; ifMatch?: string },
  ): Promise<IdempotencyOutcome> {
    return this.idempotency.begin({
      key,
      scope: SCOPE,
      actorId: actorSub(req),
      method: "POST",
      route,
      fingerprint: this.idempotency.fingerprint({ method: "POST", ...input }),
    });
  }
}

function requireId(id: string): void {
  if (!CANONICAL_UUID_REGEX.test(id))
    throw new TaxonomyError("RESOURCE_NOT_FOUND");
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
  if (!raw || raw.trim().length === 0)
    throw new TaxonomyError(
      "PRECONDITION_REQUIRED",
      "a status move must carry the If-Match of the version it was read at",
    );
  const version = parseIfMatchVersion(raw);
  if (version === null)
    throw new TaxonomyError(
      "PRECONDITION_FAILED",
      "the If-Match validator is not one this API issued",
    );
  return { raw, version };
}

function readJsonBody(req: FastifyRequest): unknown {
  const contentType = String(req.headers["content-type"] ?? "");
  if (contentType && !contentType.includes("application/json"))
    throw new TaxonomyError(
      "UNSUPPORTED_MEDIA_TYPE",
      "an application command carries no media; use application/json",
    );
  return req.body;
}

function replayed(
  outcome: IdempotencyOutcome,
  reply: FastifyReply,
): outcome is Extract<IdempotencyOutcome, { kind: "replay" }> {
  if (outcome.kind !== "replay") return false;
  void reply.status(outcome.replay.status);
  if (outcome.replay.etag) void reply.header("etag", outcome.replay.etag);
  return true;
}

function actorSub(req: FastifyRequest): string | null {
  return (req as { user?: { sub?: string } }).user?.sub ?? null;
}

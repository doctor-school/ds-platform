import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseFilters,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  CreateFeedSourceRequestSchema,
  type FeedSourceAdminList,
  IDEMPOTENCY_KEY_HEADER,
  UpdateFeedSourceRequestSchema,
} from "@ds/schemas";
import { Authz } from "../authz/index.js";
import {
  IdempotencyService,
  TaxonomyProblemFilter,
} from "../taxonomy/index.js";
import {
  actorSub,
  invalid,
  replayed,
  requireId,
  requireVersion,
} from "./admin-write.http.js";
import { FeedSourcesService } from "./feed-sources.service.js";

// 048 slice 2 (#3993) — «Материалы» → «Источники» (048-design §Endpoints
// (slice 2); EARS-20…EARS-23). The admin contract of the material routes,
// unchanged: feature 011's MFA admin session plus CSRF double-submit,
// `platform_admin` required by the route guard BEFORE validation, idempotency
// or handler; every write re-establishes the role against the live IdP, carries
// a canonical UUID `Idempotency-Key` and — except create — the `If-Match` of
// the version it was read at. The 010 audit row is written by the capture
// trigger inside the command transaction.

const SCOPE = "feed-sources";

@Controller({ path: "admin/feed-sources", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class FeedSourcesAdminController {
  constructor(
    @Inject(FeedSourcesService) private readonly sources: FeedSourcesService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  /** EARS-20 — every source with its state, status and post count. */
  @Get()
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-20", "EARS-23"],
  })
  list(): Promise<FeedSourceAdminList> {
    return this.sources.list();
  }

  /** EARS-21 — «Добавить источник»; key required, no `If-Match`. */
  @Post()
  @HttpCode(201)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-21", "EARS-23"],
  })
  async create(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const key = this.idempotency.requireKey(
      req.headers[IDEMPOTENCY_KEY_HEADER],
    );
    const parsed = CreateFeedSourceRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      throw invalid("invalid feed source payload", parsed.error);
    const path = "/v1/admin/feed-sources";
    const outcome = await this.idempotency.begin({
      key,
      scope: SCOPE,
      actorId: actorSub(req),
      method: "POST",
      route: path,
      fingerprint: this.idempotency.fingerprint({
        method: "POST",
        path,
        payload: parsed.data,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;
    const { detail, etag } = await this.sources.create({
      payload: parsed.data,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    void reply.header("location", `/v1/admin/feed-sources/${detail.id}`);
    return detail;
  }

  /** EARS-21 — «Изменить адрес» under `If-Match`, with the `href` rewrite. */
  @Patch(":id")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-21", "EARS-23"],
  })
  async update(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    requireId(id);
    const key = this.idempotency.requireKey(
      req.headers[IDEMPOTENCY_KEY_HEADER],
    );
    const { raw, version } = requireVersion(req, "an address edit");
    const parsed = UpdateFeedSourceRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      throw invalid("invalid feed source payload", parsed.error);
    const outcome = await this.idempotency.begin({
      key,
      scope: SCOPE,
      actorId: actorSub(req),
      method: "PATCH",
      route: "/v1/admin/feed-sources/:id",
      fingerprint: this.idempotency.fingerprint({
        method: "PATCH",
        path: `/v1/admin/feed-sources/${id}`,
        payload: parsed.data,
        ifMatch: raw,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;
    const { detail, etag } = await this.sources.update({
      id,
      payload: parsed.data,
      expectedVersion: version,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    return detail;
  }

  /** EARS-22 — «Выключить»: the source and its entries marked off. */
  @Post(":id/disable")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-22", "EARS-23"],
  })
  disable(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    return this.switchTo(id, "disable", req, reply);
  }

  /** EARS-22 — «Включить»: the marks cleared. */
  @Post(":id/enable")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-22", "EARS-23"],
  })
  enable(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    return this.switchTo(id, "enable", req, reply);
  }

  private async switchTo(
    id: string,
    action: "disable" | "enable",
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<unknown> {
    requireId(id);
    const key = this.idempotency.requireKey(
      req.headers[IDEMPOTENCY_KEY_HEADER],
    );
    const { raw, version } = requireVersion(req, `a ${action}`);
    const outcome = await this.idempotency.begin({
      key,
      scope: SCOPE,
      actorId: actorSub(req),
      method: "POST",
      route: `/v1/admin/feed-sources/:id/${action}`,
      fingerprint: this.idempotency.fingerprint({
        method: "POST",
        path: `/v1/admin/feed-sources/${id}/${action}`,
        payload: {},
        ifMatch: raw,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;
    const input = { id, expectedVersion: version, lease: outcome.lease };
    const { detail, etag } =
      action === "disable"
        ? await this.sources.disable(input)
        : await this.sources.enable(input);
    void reply.header("etag", etag);
    return detail;
  }
}

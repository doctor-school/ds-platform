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
  IDEMPOTENCY_KEY_HEADER,
  ResolveSpeakerMigrationReviewRequestSchema,
  SpeakerMigrationReviewListQuerySchema,
} from "@ds/schemas";
import { Authz } from "../authz/index.js";
import {
  type IdempotencyOutcome,
  IdempotencyService,
} from "./idempotency.service.js";
import { SpeakerMigrationService } from "./speaker-migration.service.js";
import { TaxonomyError } from "./taxonomy.errors.js";
import { TaxonomyProblemFilter } from "./taxonomy.problem-filter.js";

@Controller({ path: "admin/speaker-migration-reviews", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class SpeakerMigrationAdminController {
  constructor(
    @Inject(SpeakerMigrationService)
    private readonly migration: SpeakerMigrationService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-24"],
  })
  list(@Query() query: Record<string, string>) {
    const parsed = SpeakerMigrationReviewListQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw validation("invalid speaker migration queue query", parsed.error.issues);
    }
    return this.migration.list(parsed.data);
  }

  @Post(":sourceId/resolve")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-24"],
  })
  async resolve(
    @Param("sourceId") sourceId: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!CANONICAL_UUID_REGEX.test(sourceId)) {
      throw new TaxonomyError("RESOURCE_NOT_FOUND");
    }
    const key = this.idempotency.requireKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
    const parsed = ResolveSpeakerMigrationReviewRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validation("invalid speaker migration resolution", parsed.error.issues);
    }
    const path = `/v1/admin/speaker-migration-reviews/${sourceId}/resolve`;
    const outcome = await this.idempotency.begin({
      key,
      scope: "taxonomy.speaker-migration.resolve",
      actorId: actorSub(req),
      method: "POST",
      route: "/v1/admin/speaker-migration-reviews/:sourceId/resolve",
      fingerprint: this.idempotency.fingerprint({
        method: "POST",
        path,
        payload: parsed.data,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;
    return this.migration.resolve({
      sourceId,
      payload: parsed.data,
      reviewerId: requireActor(req),
      lease: outcome.lease,
    });
  }

  @Post("cutover")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-24"],
  })
  async cutover(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const key = this.idempotency.requireKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
    if (req.body !== undefined && req.body !== null) {
      throw new TaxonomyError("VALIDATION_FAILED", "cutover has no request body");
    }
    const path = "/v1/admin/speaker-migration-reviews/cutover";
    const outcome = await this.idempotency.begin({
      key,
      scope: "taxonomy.speaker-migration.cutover",
      actorId: actorSub(req),
      method: "POST",
      route: path,
      fingerprint: this.idempotency.fingerprint({ method: "POST", path }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;
    return this.migration.cutover({
      reviewerId: requireActor(req),
      lease: outcome.lease,
    });
  }
}

function validation(
  detail: string,
  issues: readonly { path: PropertyKey[]; message: string }[],
) {
  return new TaxonomyError(
    "VALIDATION_FAILED",
    detail,
    issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  );
}

function actorSub(req: FastifyRequest): string | null {
  return (req as { user?: { sub?: string } }).user?.sub ?? null;
}

function requireActor(req: FastifyRequest): string {
  const sub = actorSub(req);
  if (!sub) throw new TaxonomyError("ADMIN_SESSION_REQUIRED");
  return sub;
}

function replayed(
  outcome: IdempotencyOutcome,
  reply: FastifyReply,
): outcome is Extract<IdempotencyOutcome, { kind: "replay" }> {
  if (outcome.kind !== "replay") return false;
  void reply.status(outcome.replay.status);
  return true;
}

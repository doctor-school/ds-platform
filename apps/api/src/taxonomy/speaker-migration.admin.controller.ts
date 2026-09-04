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
  ImportSpeakerMigrationReviewsRequestSchema,
  RecordPhaseAwareReleaseRequestSchema,
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

  /** The cutover SSOT as the admin surface sees it (#1633 singleton). */
  @Get("state")
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-24"],
  })
  state() {
    return this.migration.state();
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

  /**
   * Design §2.3 stage 1 — import the owner-reviewed classification artifact.
   * The artifact is the ONLY source of classification; nothing here derives it.
   */
  @Post("import")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-24"],
  })
  async import(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const key = this.idempotency.requireKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
    const parsed = ImportSpeakerMigrationReviewsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validation(
        "invalid reviewed classification artifact",
        parsed.error.issues,
      );
    }
    const path = "/v1/admin/speaker-migration-reviews/import";
    const outcome = await this.idempotency.begin({
      key,
      scope: "taxonomy.speaker-migration.import",
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
    return this.migration.importReviewedRows({
      payload: parsed.data,
      actorId: requireActor(req),
      lease: outcome.lease,
    });
  }

  /**
   * Record the expand release's SHA/ordinal (the rollback floor prerequisite the
   * #1633 reader consumes). Explicit operator command — see the PR body's
   * declared deviation: automating it from `tools/deploy/prod.mjs` is follow-up,
   * and a stub value here would be exactly the hack AGENTS.md §6 forbids.
   */
  @Post("phase-aware-release")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-24"],
  })
  async recordPhaseAwareRelease(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const key = this.idempotency.requireKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
    const parsed = RecordPhaseAwareReleaseRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validation("invalid phase-aware release", parsed.error.issues);
    }
    const path = "/v1/admin/speaker-migration-reviews/phase-aware-release";
    const outcome = await this.idempotency.begin({
      key,
      scope: "taxonomy.speaker-migration.phase-aware-release",
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
    return this.migration.recordPhaseAwareRelease({
      payload: parsed.data,
      actorId: requireActor(req),
      lease: outcome.lease,
    });
  }

  /** Design §2.3 stage 2 — the guarded, serializable source closure. */
  @Post("close-source")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-24"],
  })
  async closeSource(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const key = this.idempotency.requireKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
    if (req.body !== undefined && req.body !== null) {
      throw new TaxonomyError(
        "VALIDATION_FAILED",
        "source closure has no request body",
      );
    }
    const path = "/v1/admin/speaker-migration-reviews/close-source";
    const outcome = await this.idempotency.begin({
      key,
      scope: "taxonomy.speaker-migration.close-source",
      actorId: actorSub(req),
      method: "POST",
      route: path,
      fingerprint: this.idempotency.fingerprint({ method: "POST", path }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;
    return this.migration.closeSource({
      actorId: requireActor(req),
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

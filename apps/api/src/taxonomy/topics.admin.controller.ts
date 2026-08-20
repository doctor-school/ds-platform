import {
  Controller,
  Get,
  Inject,
  HttpCode,
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
  CreateTopicRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IF_MATCH_HEADER,
  parseIfMatchVersion,
  type TopicAdminList,
  UpdateTopicRequestSchema,
} from "@ds/schemas";
import { Authz } from "../authz/index.js";
import {
  type IdempotencyOutcome,
  IdempotencyService,
} from "./idempotency.service.js";
import { TaxonomyError } from "./taxonomy.errors.js";
import { TaxonomyProblemFilter } from "./taxonomy.problem-filter.js";
import { TopicsService } from "./topics.service.js";

// 012 EARS-3 (#1285) — the curated topic admin surface (012-design §5.1). The
// contract is the one the project vertical established, unchanged: authorization
// is feature 011's dedicated MFA-verified admin session plus CSRF double-submit,
// and the route guard requires `platform_admin` BEFORE validation, idempotency
// or handler (EARS-16). There is no per-mutation live IdP revalidation and no
// step-up in 012 (§5.3).
//
// The request shape is the SIMPLE half of §5.1: "topics and every request
// without a binary use `application/json`". A topic has no media slot at all,
// so there is no multipart branch here to mirror — an upload would have no
// column to land in. Anything that is not JSON is 415, which is why this
// controller stays a third the size of its sibling without omitting a contract.

@Controller({ path: "admin/topics", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class TopicsAdminController {
  // Explicit @Inject tokens — see the note in `topics.service.ts`: the
  // root-level authz gate boots this graph under `tsx`, which emits no
  // `design:paramtypes`, so type-inferred injection resolves to `undefined`.
  constructor(
    @Inject(TopicsService) private readonly topics: TopicsService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * EARS-15 / §5.1 — the shared admin list: page/pageSize offset pagination,
   * case-insensitive `q` (LD-6 trigram-indexed over title and slug), explicit
   * `status`, and retired rows excluded by default.
   */
  @Get()
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-3", "EARS-15", "EARS-16"],
  })
  list(@Query() rawQuery: Record<string, string>): Promise<TopicAdminList> {
    const parsed = AdminTaxonomyListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new TaxonomyError(
        "VALIDATION_FAILED",
        "invalid list query",
        parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      );
    }
    return this.topics.list(parsed.data);
  }

  /**
   * EARS-3 — `POST /v1/admin/topics`. Requires a canonical UUID
   * `Idempotency-Key`, no `If-Match` (there is no prior version to assert).
   * Answers 201 with the detail body, the row's `ETag` and a `Location`.
   *
   * This is the ONLY way a topic comes into being: there is no inline creation
   * from an event form, so a subject heading is always the curated row an
   * operator authored here (EARS-3).
   */
  @Post()
  @HttpCode(201)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    // #1304 (ADR-0001 §10): a state-changing admin command is high-stakes, so
    // the role is re-established against the LIVE IdP before anything happens —
    // the guard refuses ahead of validation and the idempotency reservation, so
    // a revoked grant cannot leave a half-written topic behind. Reads keep it
    // absent, by the same cost argument. Identical posture to the sibling
    // project and expert writes; a topic has no upload stage to fence.
    revalidate: "live",
    // The domain audit row is written by feature 010's capture trigger inside
    // the command transaction (012-design §6), not by an authz-tier emission —
    // so this is the same `low-stakes` AUTH-audit tier as 007's authoring writes.
    audit: "low-stakes",
    tests: ["EARS-3", "EARS-16", "EARS-17"],
  })
  async create(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    // 1. Key shape — before any payload work (§5.1 failure order).
    const key = this.idempotency.requireKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
    // 2. Request shape + payload.
    const parsed = CreateTopicRequestSchema.safeParse(
      readJsonBody(req, false),
    );
    if (!parsed.success) {
      throw new TaxonomyError(
        "VALIDATION_FAILED",
        "invalid topic payload",
        parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      );
    }
    // 3. Fingerprint binding.
    const outcome = await this.idempotency.begin({
      key,
      scope: "taxonomy.topics",
      actorId: actorSub(req),
      method: "POST",
      route: "/v1/admin/topics",
      fingerprint: this.idempotency.fingerprint({
        method: "POST",
        path: "/v1/admin/topics",
        payload: parsed.data,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;

    const { detail, etag } = await this.topics.create({
      payload: parsed.data,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    void reply.header("location", `/v1/admin/topics/${detail.id}`);
    return detail;
  }

  /** EARS-3 — detail by stable id, retired rows included (§5.1). */
  @Get(":id")
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-3", "EARS-16"],
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
    const { detail, etag } = await this.topics.detail(id);
    void reply.header("etag", etag);
    return detail;
  }

  /**
   * EARS-3 — `PATCH /v1/admin/topics/:id`. Requires the target `If-Match`
   * (absent is 428 `PRECONDITION_REQUIRED`, stale is 412 `PRECONDITION_FAILED`)
   * plus a canonical UUID `Idempotency-Key`.
   */
  @Patch(":id")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    // Same #1304 posture as `create` — the edit command re-establishes the role
    // against the live IdP before validation or the If-Match version check.
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-3", "EARS-16", "EARS-17"],
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
    const rawIfMatch = req.headers[IF_MATCH_HEADER] as string | undefined;
    if (!rawIfMatch || rawIfMatch.trim().length === 0) {
      throw new TaxonomyError(
        "PRECONDITION_REQUIRED",
        "an edit must carry the If-Match of the version it was read at",
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

    const parsed = UpdateTopicRequestSchema.safeParse(readJsonBody(req, true));
    if (!parsed.success) {
      throw new TaxonomyError(
        "VALIDATION_FAILED",
        "invalid topic payload",
        parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      );
    }

    const route = "/v1/admin/topics/:id";
    const outcome = await this.idempotency.begin({
      key,
      scope: "taxonomy.topics",
      actorId: actorSub(req),
      method: "PATCH",
      route,
      fingerprint: this.idempotency.fingerprint({
        method: "PATCH",
        path: `/v1/admin/topics/${id}`,
        payload: parsed.data,
        ifMatch: rawIfMatch,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;

    const { detail, etag } = await this.topics.update({
      id,
      payload: parsed.data,
      expectedVersion,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    return detail;
  }
}

/**
 * Read the exact §5.1 request shape for an entity with no media slot: JSON, or
 * nothing this API accepts.
 *
 * Multipart is refused with the SAME 415 as any other non-JSON content type —
 * for a topic it is not "an upload in the wrong place", it is a shape that could
 * never be satisfied, because there is no file part name to accept.
 */
function readJsonBody(req: FastifyRequest, bodyOptional: boolean): unknown {
  const contentType = String(req.headers["content-type"] ?? "");
  if (contentType && !contentType.includes("application/json")) {
    throw new TaxonomyError(
      "UNSUPPORTED_MEDIA_TYPE",
      "a topic carries no media; use application/json",
    );
  }
  return req.body ?? (bodyOptional ? {} : undefined);
}

/**
 * Replay a completed record's stored outcome verbatim (§6): the exact status,
 * body and allow-listed `ETag`/`Location`. Returns `true` when the caller must
 * return the stored body instead of running the command again.
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

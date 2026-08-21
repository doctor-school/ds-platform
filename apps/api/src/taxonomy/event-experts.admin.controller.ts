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
  AdminEventExpertListQuerySchema,
  CANONICAL_UUID_REGEX,
  CreateEventExpertRequestSchema,
  type EventExpertAdminList,
  IDEMPOTENCY_KEY_HEADER,
  IF_MATCH_HEADER,
  parseIfMatchVersion,
  UpdateEventExpertRequestSchema,
} from "@ds/schemas";
import { Authz } from "../authz/index.js";
import { EventExpertsService } from "./event-experts.service.js";
import {
  type IdempotencyOutcome,
  IdempotencyService,
} from "./idempotency.service.js";
import { TaxonomyError } from "./taxonomy.errors.js";
import { TaxonomyProblemFilter } from "./taxonomy.problem-filter.js";

// 012 EARS-7 (#1289) — the admin surface of the explicit expert↔event link
// (012-design §5.1, route table §…/286). It is the same contract the four
// taxonomy entity controllers established — `platform_admin` enforced by the
// route guard BEFORE validation or idempotency (EARS-16), a canonical UUID
// `Idempotency-Key` on every mutation, `If-Match` on every edit of an existing
// row, RFC 7807 through the shared filter — with two shape differences that
// follow from this being a JOIN rather than an entity:
//
//   - there is no media branch and no slug, so JSON is the only request shape;
//   - `eventId`/`expertId` are NOT patchable. Re-pointing a link would rewrite
//     history the audit ledger already attributes to the original pair, so a
//     re-point is `retire` + a new link, not an edit. The update DTO carries
//     `role`, `position` and `legacySpeakerId` only.
//
// `retire`/`restore` are plain join transitions: no `LifecycleImpact` preview
// and no `Lifecycle-Impact-Token`. That mechanism belongs to ENTITY retire
// (EARS-13/14, #1288) and no taxonomy resource exposes it yet — see the
// service's note.

@Controller({ path: "admin/event-experts", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class EventExpertsAdminController {
  // Explicit @Inject tokens — see the note in `event-experts.service.ts`: the
  // root-level authz gate boots this graph under `tsx`, which emits no
  // `design:paramtypes`, so type-inferred injection resolves to `undefined`.
  constructor(
    @Inject(EventExpertsService)
    private readonly links: EventExpertsService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * EARS-15 / §5.1 — the join list: page/pageSize offset pagination filtered by
   * `eventId`, `expertId` and `status`, with retired links excluded unless
   * `includeRetired` asks for them.
   */
  @Get()
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-7", "EARS-15", "EARS-16"],
  })
  list(
    @Query() rawQuery: Record<string, string>,
  ): Promise<EventExpertAdminList> {
    const parsed = AdminEventExpertListQuerySchema.safeParse(rawQuery);
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
    return this.links.list(parsed.data);
  }

  /**
   * EARS-7 — `POST /v1/admin/event-experts`. The ONLY way a link comes into
   * being, and the only way a legacy speaker acquires a match: `legacySpeakerId`
   * is operator-supplied, never inferred from a name (§2.3 / §4 LD-2).
   */
  @Post()
  @HttpCode(201)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    // #1304 (ADR-0001 §10): a state-changing admin command re-establishes the
    // role against the LIVE IdP before validation or the idempotency
    // reservation, so a revoked grant cannot leave a half-written link behind.
    revalidate: "live",
    // The domain audit row is written by feature 010's capture trigger inside
    // the command transaction (012-design §6) — this is the AUTH-audit tier.
    audit: "low-stakes",
    tests: ["EARS-7", "EARS-16", "EARS-17"],
  })
  async create(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    // 1. Key shape — before any payload work (§5.1 failure order).
    const key = this.idempotency.requireKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
    // 2. Request shape + payload.
    const parsed = CreateEventExpertRequestSchema.safeParse(
      readJsonBody(req, false),
    );
    if (!parsed.success) {
      throw new TaxonomyError(
        "VALIDATION_FAILED",
        "invalid event-expert link payload",
        parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      );
    }
    // 3. Fingerprint binding.
    const outcome = await this.idempotency.begin({
      key,
      scope: "taxonomy.event-experts",
      actorId: actorSub(req),
      method: "POST",
      route: "/v1/admin/event-experts",
      fingerprint: this.idempotency.fingerprint({
        method: "POST",
        path: "/v1/admin/event-experts",
        payload: parsed.data,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;

    const { detail, etag } = await this.links.create({
      payload: parsed.data,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    void reply.header("location", `/v1/admin/event-experts/${detail.id}`);
    return detail;
  }

  /** EARS-7 — detail by stable id, retired links included (§5.1). */
  @Get(":id")
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-7", "EARS-16"],
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
    const { detail, etag } = await this.links.detail(id);
    void reply.header("etag", etag);
    return detail;
  }

  /**
   * EARS-7 — `PATCH /v1/admin/event-experts/:id`. Edits the role, the position
   * and the legacy match of the SAME pair; the endpoints themselves are
   * immutable (see the file header).
   */
  @Patch(":id")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-7", "EARS-16", "EARS-17"],
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
    const rawIfMatch = requireIfMatch(req);
    const expectedVersion = requireVersion(rawIfMatch);

    const parsed = UpdateEventExpertRequestSchema.safeParse(
      readJsonBody(req, true),
    );
    if (!parsed.success) {
      throw new TaxonomyError(
        "VALIDATION_FAILED",
        "invalid event-expert link payload",
        parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      );
    }

    const route = "/v1/admin/event-experts/:id";
    const outcome = await this.idempotency.begin({
      key,
      scope: "taxonomy.event-experts",
      actorId: actorSub(req),
      method: "PATCH",
      route,
      fingerprint: this.idempotency.fingerprint({
        method: "PATCH",
        path: `/v1/admin/event-experts/${id}`,
        payload: parsed.data,
        ifMatch: rawIfMatch,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;

    const { detail, etag } = await this.links.update({
      id,
      payload: parsed.data,
      expectedVersion,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    return detail;
  }

  /**
   * EARS-7/EARS-14 — `POST /v1/admin/event-experts/:id/retire`. The link stops
   * being visible; the row is RETAINED, so its legacy speaker becomes visible
   * again at its own position (which is why the service re-checks the
   * projection even on a retire).
   */
  @Post(":id/retire")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-7", "EARS-14", "EARS-16", "EARS-17"],
  })
  retire(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    return this.transition(id, req, reply, "retire");
  }

  /** EARS-7/EARS-14 — `POST /v1/admin/event-experts/:id/restore`. */
  @Post(":id/restore")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-7", "EARS-14", "EARS-16", "EARS-17"],
  })
  restore(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    return this.transition(id, req, reply, "restore");
  }

  /**
   * Both transitions share one body because they share the whole contract: no
   * request body at all, the target `If-Match`, a canonical `Idempotency-Key`,
   * and a fingerprint over `{method, path, ifMatch}` — there is no payload to
   * bind, so the asserted version IS the request's identity.
   */
  private async transition(
    id: string,
    req: FastifyRequest,
    reply: FastifyReply,
    transition: "retire" | "restore",
  ): Promise<unknown> {
    if (!CANONICAL_UUID_REGEX.test(id)) {
      throw new TaxonomyError("RESOURCE_NOT_FOUND");
    }
    const key = this.idempotency.requireKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
    const rawIfMatch = requireIfMatch(req);
    const expectedVersion = requireVersion(rawIfMatch);

    const route = `/v1/admin/event-experts/:id/${transition}`;
    const path = `/v1/admin/event-experts/${id}/${transition}`;
    const outcome = await this.idempotency.begin({
      key,
      scope: "taxonomy.event-experts",
      actorId: actorSub(req),
      method: "POST",
      route,
      fingerprint: this.idempotency.fingerprint({
        method: "POST",
        path,
        ifMatch: rawIfMatch,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;

    const { detail, etag } = await (transition === "retire"
      ? this.links.retire({ id, expectedVersion, lease: outcome.lease })
      : this.links.restore({ id, expectedVersion, lease: outcome.lease }));
    void reply.header("etag", etag);
    return detail;
  }
}

/**
 * A write against an existing link must carry the `If-Match` of the version it
 * was read at — absent is 428 `PRECONDITION_REQUIRED`.
 */
function requireIfMatch(req: FastifyRequest): string {
  const raw = req.headers[IF_MATCH_HEADER] as string | undefined;
  if (!raw || raw.trim().length === 0) {
    throw new TaxonomyError(
      "PRECONDITION_REQUIRED",
      "an edit must carry the If-Match of the version it was read at",
    );
  }
  return raw;
}

/**
 * A syntactically unusable validator asserts nothing, so it cannot pass: treat
 * it as the failed precondition it is, never as "no precondition".
 */
function requireVersion(rawIfMatch: string): number {
  const expectedVersion = parseIfMatchVersion(rawIfMatch);
  if (expectedVersion === null) {
    throw new TaxonomyError(
      "PRECONDITION_FAILED",
      "the If-Match validator is not one this API issued",
    );
  }
  return expectedVersion;
}

/**
 * Read the exact §5.1 request shape for a resource with no media slot: JSON, or
 * nothing this API accepts. A link has no file part name to accept, so
 * multipart is not "an upload in the wrong place" — it is a shape that could
 * never be satisfied, and it gets the same 415 as any other non-JSON type.
 */
function readJsonBody(req: FastifyRequest, bodyOptional: boolean): unknown {
  const contentType = String(req.headers["content-type"] ?? "");
  if (contentType && !contentType.includes("application/json")) {
    throw new TaxonomyError(
      "UNSUPPORTED_MEDIA_TYPE",
      "an event-expert link carries no media; use application/json",
    );
  }
  return req.body ?? (bodyOptional ? {} : undefined);
}

/**
 * Replay a completed record's stored outcome verbatim (§6): the exact status,
 * body and allow-listed `ETag`/`Location`.
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

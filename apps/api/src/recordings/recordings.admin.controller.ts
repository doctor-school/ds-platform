import {
  Body,
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
  AttachRecordingRequestSchema,
  CANONICAL_UUID_REGEX,
  IDEMPOTENCY_KEY_HEADER,
  IF_MATCH_HEADER,
  parseIfMatchVersion,
  type RecordingAdminList,
  type RecordingCommand,
  UpdateRecordingRequestSchema,
} from "@ds/schemas";
import { Authz } from "../authz/index.js";
import {
  type IdempotencyOutcome,
  IdempotencyService,
} from "../taxonomy/idempotency.service.js";
import { TaxonomyError } from "../taxonomy/taxonomy.errors.js";
import { TaxonomyProblemFilter } from "../taxonomy/taxonomy.problem-filter.js";
import { RecordingsService } from "./recordings.service.js";

// 014 EARS-1 / EARS-2 / EARS-17 (#1339) — the operator's recording surface
// (014-design §10). Authorization is feature 011 exactly as 007 and 012 have it:
// the dedicated MFA-verified admin session plus CSRF double-submit, and the route
// guard requires `platform_admin` BEFORE validation, idempotency or handler.
//
// EARS-17 is realized by CONSUMING the retained fenced idempotency contract 012
// already owns — one `idempotency_keys` table, one `IdempotencyService`, one RFC
// 7807 filter. A second protocol for the same guarantee would be two answers to
// «did my retry double-apply».
//
// The failure ORDER is the contract, and it is 012's order unchanged:
//
//   auth (guard) → Idempotency-Key shape → If-Match presence/shape → payload
//   shape → fingerprint binding → domain transaction
//
// so a keyless request never validates a payload and a reused key never reaches
// the row lock.
//
// NOTE the routes this controller does NOT have. There is no `@Delete` anywhere
// in feature 014 (§3, EARS-2): retire is the terminal action, it is reversible,
// and the router's own 404 is the answer to a Delete attempt.

/** The four §3 lifecycle commands, as the path segments that invoke them. */
const COMMAND_PATHS = ["publish", "unpublish", "retire", "restore"] as const;

@Controller({ path: "admin/events/:eventId/recordings", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class RecordingsAdminController {
  // Explicit @Inject tokens — the endpoint-authz gate boots this graph under
  // `tsx`, which emits no `design:paramtypes` (apps/api/src/taxonomy/README.md).
  constructor(
    @Inject(RecordingsService) private readonly recordings: RecordingsService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  /** EARS-1 — every retained row of the event, retired ones included. */
  @Get()
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-1", "EARS-17"],
  })
  list(@Param("eventId") eventId: string): Promise<RecordingAdminList> {
    return this.recordings.list(requireUuid(eventId));
  }

  /**
   * EARS-1 — `POST /v1/admin/events/:id/recordings`. Requires a canonical UUID
   * `Idempotency-Key`; NO `If-Match`, because a create asserts no prior version.
   * Answers 201 with the row, its `ETag` and a `Location`.
   */
  @Post()
  @HttpCode(201)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    // The domain audit row is written by feature 010's capture trigger inside
    // the command transaction, not by an authz-tier emission — the same
    // `low-stakes` AUTH-audit tier 007 and 012 use for authoring writes.
    audit: "low-stakes",
    tests: ["EARS-1", "EARS-17"],
  })
  async attach(
    @Param("eventId") eventIdRaw: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const eventId = requireUuid(eventIdRaw);
    const key = this.idempotency.requireKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
    const parsed = AttachRecordingRequestSchema.safeParse(body ?? {});
    if (!parsed.success) throw validationFailed(parsed.error.issues);

    const path = `/v1/admin/events/${eventId}/recordings`;
    const outcome = await this.idempotency.begin({
      key,
      scope: "recordings",
      actorId: actorSub(req),
      method: "POST",
      route: "/v1/admin/events/:eventId/recordings",
      fingerprint: this.idempotency.fingerprint({
        method: "POST",
        path,
        payload: parsed.data,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;

    const { detail, etag } = await this.recordings.attach({
      eventId,
      payload: parsed.data,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    void reply.header("location", `${path}/${detail.id}`);
    return detail;
  }

  /**
   * EARS-1 — `PATCH …/:rid`: correct the source, poster or duration of the SAME
   * row. Requires the target `If-Match` plus a canonical UUID `Idempotency-Key`.
   * `kind` is not patchable — moving a recording between kind slots is a retire
   * plus a fresh attach, so that the occupied-slot refusal still applies.
   */
  @Patch(":recordingId")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-1", "EARS-17"],
  })
  async update(
    @Param("eventId") eventIdRaw: string,
    @Param("recordingId") recordingIdRaw: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const eventId = requireUuid(eventIdRaw);
    const recordingId = requireUuid(recordingIdRaw);
    const key = this.idempotency.requireKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
    const { raw: rawIfMatch, version: expectedVersion } = this.requireIfMatch(req);
    const parsed = UpdateRecordingRequestSchema.safeParse(body ?? {});
    if (!parsed.success) throw validationFailed(parsed.error.issues);

    const path = `/v1/admin/events/${eventId}/recordings/${recordingId}`;
    const outcome = await this.idempotency.begin({
      key,
      scope: "recordings",
      actorId: actorSub(req),
      method: "PATCH",
      route: "/v1/admin/events/:eventId/recordings/:recordingId",
      fingerprint: this.idempotency.fingerprint({
        method: "PATCH",
        path,
        payload: parsed.data,
        ifMatch: rawIfMatch,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;

    const { detail, etag } = await this.recordings.update({
      eventId,
      recordingId,
      payload: parsed.data,
      expectedVersion,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    return detail;
  }

  /**
   * EARS-2 — the four §3 lifecycle commands. One handler over a path-parameter
   * command rather than four near-identical ones: the protocol preamble
   * (key → If-Match → fingerprint → replay) is identical for all four, and four
   * copies of it is four places for the order to drift. The command itself is
   * validated against the closed set, so `…/delete` is a 404 from the router.
   */
  @Post(":recordingId/:command")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    // A recording lifecycle transition is a deliberate operator act on published
    // content; feature 010's trigger writes the domain row inside the command
    // transaction, as for every other authoring write on this surface.
    audit: "low-stakes",
    tests: ["EARS-2", "EARS-17"],
  })
  async command(
    @Param("eventId") eventIdRaw: string,
    @Param("recordingId") recordingIdRaw: string,
    @Param("command") commandRaw: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const eventId = requireUuid(eventIdRaw);
    const recordingId = requireUuid(recordingIdRaw);
    // An unknown segment names no command this API has. 404 rather than 400:
    // there is no resource at that path, which is exactly what a Delete attempt
    // must be told (§3, EARS-2).
    if (!isCommand(commandRaw)) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    const command: RecordingCommand = commandRaw;

    const key = this.idempotency.requireKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
    const { raw: rawIfMatch, version: expectedVersion } = this.requireIfMatch(req);

    const path = `/v1/admin/events/${eventId}/recordings/${recordingId}/${command}`;
    const outcome = await this.idempotency.begin({
      key,
      scope: "recordings",
      actorId: actorSub(req),
      method: "POST",
      route: "/v1/admin/events/:eventId/recordings/:recordingId/:command",
      fingerprint: this.idempotency.fingerprint({
        method: "POST",
        path,
        ifMatch: rawIfMatch,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;

    const { detail, etag } = await this.recordings.transition({
      eventId,
      recordingId,
      command,
      expectedVersion,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    return detail;
  }

  /**
   * EARS-17 — the precondition every non-create mutation carries. Absent is 428
   * `PRECONDITION_REQUIRED`; present but not a validator this API issued is 412
   * `PRECONDITION_FAILED`, because a syntactically unusable validator asserts
   * nothing and therefore cannot pass — treating it as «no precondition» would
   * turn a malformed header into a bypass.
   */
  private requireIfMatch(req: FastifyRequest): { raw: string; version: number } {
    const raw = req.headers[IF_MATCH_HEADER] as string | undefined;
    if (!raw || raw.trim().length === 0) {
      throw new TaxonomyError(
        "PRECONDITION_REQUIRED",
        "a recording mutation must carry the If-Match of the version it was read at",
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
}

function isCommand(value: string): value is RecordingCommand {
  return (COMMAND_PATHS as readonly string[]).includes(value);
}

/** The admin surface is id-only: a non-UUID token addresses nothing. */
function requireUuid(value: string): string {
  if (!CANONICAL_UUID_REGEX.test(value)) {
    throw new TaxonomyError("RESOURCE_NOT_FOUND");
  }
  return value;
}

function validationFailed(
  issues: readonly { path: PropertyKey[]; message: string }[],
): TaxonomyError {
  return new TaxonomyError(
    "VALIDATION_FAILED",
    "invalid recording payload",
    issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  );
}

/**
 * Replay a completed record's stored outcome verbatim: the exact status, body
 * and allow-listed `ETag`/`Location`. Returns `true` when the caller must return
 * the stored body instead of running the command again.
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

import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { DrizzleHandle } from "@ds/db";
import {
  type EventAdminDetail,
  IDEMPOTENCY_KEY_HEADER,
  taxonomyETag,
} from "@ds/schemas";
import { Authz } from "../authz/index.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { IdempotencyService } from "../taxonomy/idempotency.service.js";
import { LegacyBroadcastCreateDto } from "./events.dto.js";
import { EventsService } from "./events.service.js";
import { withProtocolRefusalShape } from "./protocol-refusal-shape.js";

/**
 * 014 EARS-24 (#1741) — the «Архивный эфир» creation surface
 * (`POST /v1/admin/legacy-broadcasts`, `platform_admin`).
 *
 * A SEPARATE controller from `EventsAdminController` on purpose, and not merely
 * because the path prefix differs. 014-design §3.1 splits the aggregate into two
 * machines keyed by `events.origin`, and `POST /v1/admin/events` is the entry to
 * the PLATFORM one: an эфир the platform will host, born `draft`, en route to a
 * room. This route is the entry to the LEGACY one: an эфир the platform never
 * hosted, born `hidden`, that will only ever carry a recording. Folding them into
 * one route behind a body flag would make «which machine is this event on?» a
 * client's decision instead of the server's, which is exactly the coupling the
 * origin column exists to remove.
 *
 * The body is JSON (no multipart): a legacy эфир has no program PDF to upload —
 * it already happened.
 */
@Controller({ path: "admin/legacy-broadcasts", version: "1" })
export class LegacyBroadcastsAdminController {
  constructor(
    @Inject(EventsService) private readonly events: EventsService,
    // 014 EARS-17 — the ONE shared idempotency record (012-design §6), the same
    // `IdempotencyService` the recordings surface and 014's fenced legacy
    // commands consume. Every parameter carries an explicit `@Inject` token: a
    // single parameter decorator makes the endpoint-authz gate's tsx transform
    // drop this class's `design:paramtypes`, so undecorated siblings would fail
    // to resolve at boot (see `EventsAdminController`'s constructor note).
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(DRIZZLE_DB) private readonly db: DrizzleHandle["db"],
  ) {}

  /**
   * 014 EARS-24 — create one `legacy` эфир from its title, held-at instant,
   * duration, speakers and the recording it exists to carry. The event and the
   * recording land in ONE transaction (see
   * `EventsRepository.insertLegacyBroadcast`), so an эфир that can never be
   * archived is not a reachable state.
   *
   * `origin` and `state` are SERVER-assigned and are refused at the I/O boundary:
   * `LegacyBroadcastCreateBodySchema` is `.strict()`, so a body carrying either
   * key is a 400 before this handler runs. The эфир is born `hidden` and appears
   * on no public surface until an explicit `ArchiveLegacyBroadcast`.
   *
   * Like 007's `create`, the 201 carries the aggregate AND its `ETag`, so an
   * operator that creates and then immediately archives does not have to re-read
   * the detail just to obtain an `If-Match`.
   */
  @Post()
  @HttpCode(201)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    // Endpoint-authz AUTH-audit tier (ADR-0001 §2.5/§8): an authenticated admin
    // write, not a lifecycle transition and not an auth security event — the
    // ADR-0003 §6 domain rows are feature 010's capture-trigger obligation,
    // written inside the repository transaction.
    audit: "low-stakes",
    // #1304 default-deny: a brand-new admin mutation revalidates live.
    revalidate: "live",
    tests: ["EARS-24", "EARS-8", "EARS-17"],
  })
  async create(
    @Body() body: LegacyBroadcastCreateDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<EventAdminDetail> {
    const actor = (req as { user?: { sub?: string } }).user?.sub ?? null;
    // 014 EARS-17.1 — a canonical-UUID `Idempotency-Key` is required BEFORE any
    // domain work: this route authors an эфир, so a retried create without the
    // key would author a second one. The 012 refusals (428 key required, 400
    // malformed, 409 reuse / in-progress) are `TaxonomyError`s re-shaped onto
    // this module's `{ code, message }` envelope — `EventsModule` deliberately
    // does not mount `TaxonomyProblemFilter` (see its header comment).
    //
    // A create takes NO `If-Match`: it asserts no prior revision.
    const outcome = await withProtocolRefusalShape(async () => {
      const key = this.idempotency.requireKey(
        req.headers[IDEMPOTENCY_KEY_HEADER],
      );
      return this.idempotency.begin({
        key,
        scope: "events",
        actorId: actor,
        method: "POST",
        route: "/v1/admin/legacy-broadcasts",
        // The whole bound input is the validated body: the same key with a
        // DIFFERENT эфир is a reuse, not a replay of this one.
        fingerprint: this.idempotency.fingerprint({
          method: "POST",
          path: "/v1/admin/legacy-broadcasts",
          payload: body,
        }),
      });
    });
    if (outcome.kind === "replay") {
      void reply.status(outcome.replay.status);
      if (outcome.replay.etag) void reply.header("etag", outcome.replay.etag);
      return outcome.replay.body as EventAdminDetail;
    }

    const detail = await this.events.createLegacyBroadcast(body);
    const etag = taxonomyETag(detail.version);
    // The stored bytes ARE the bytes sent, so an exact retry replays this 201
    // verbatim instead of authoring a second эфир. Completed on the pool right
    // after the create commits rather than enlisted in its transaction: the
    // insert is owned by `EventsRepository.insertLegacyBroadcast`, which takes
    // no fence parameter, so the record is closed from here.
    //
    // The guarantee that buys is BOUNDED, not absolute. A process death in the
    // gap leaves the record `processing`, so a retry is refused as in-progress
    // — but only for the `IDEMPOTENCY_LEASE_MS` window (60 s). Once the lease
    // lapses, `IdempotencyService.begin` CAS-takes the stale record over and
    // this handler re-executes the insert, authoring a second эфир; and a
    // `complete()` that is fenced out throws `IdempotencyFenceError`, which
    // `withProtocolRefusalShape` does not map, so the caller sees a 500 on a
    // create that DID commit. Both windows close when the record is enlisted in
    // the insert transaction — thread a fence through
    // `EventsService.createLegacyBroadcast` once PR #1898 releases that file
    // (DEBT.md, 2026-09-05).
    await this.idempotency.complete(this.db, outcome.lease, {
      status: 201,
      body: detail,
      etag,
    });
    void reply.header("etag", etag);
    return detail;
  }
}

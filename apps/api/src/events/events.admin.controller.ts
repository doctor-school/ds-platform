import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  NotFoundException,
  Param,
  Patch,
  Post,
  PreconditionFailedException,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiOkResponse, ApiQuery } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  CreateEventRequestSchema,
  type EventAdminDetail,
  type EventAdminList,
  EventAdminListQuerySchema,
  IDEMPOTENCY_KEY_HEADER,
  IF_MATCH_HEADER,
  parseIfMatchVersion,
  taxonomyETag,
  UpdateEventRequestSchema,
} from "@ds/schemas";
import { Authz } from "../authz/index.js";
import {
  type IdempotencyLease,
  IdempotencyService,
} from "../taxonomy/idempotency.service.js";
import { TaxonomyError } from "../taxonomy/taxonomy.errors.js";
import {
  ConfigureStreamRequestDto,
  EventAdminListDto,
  TransitionEventRequestDto,
} from "./events.dto.js";
import {
  EventNotEditableError,
  EventNotFinishedError,
  EventsService,
  EventVersionConflictError,
  InvalidTransitionError,
  StreamNotConfigurableError,
  type TransitionFence,
  type UploadedPdf,
} from "./events.service.js";

const MAX_PDF_BYTES = 25 * 1024 * 1024;

/**
 * 007 admin event surface (`platform_admin`, role fast-path — design §7). EARS-1
 * lands `CreateEvent` (`POST /v1/admin/events`) plus the two admin reads
 * (`EventAdminList` / `EventAdminDetail`); the edit / stream-config / transition
 * commands are sibling handlers (EARS-2…7). Every route carries the EARS-8
 * classification `authenticated` / `platform_admin` / `fast-path`; the global
 * `AuthzGuard` refuses `doctor_guest` and public callers fail-closed.
 *
 * The create request is `multipart/form-data`: a `payload` JSON field (validated
 * against the `@ds/schemas` SSOT) plus an optional `programPdf` file uploaded to
 * object storage. Parsed manually off the Fastify request — the JSON+file shape
 * does not fit `@Body()` DTO validation, so the payload is Zod-parsed here.
 */
@Controller({ path: "admin/events", version: "1" })
export class EventsAdminController {
  constructor(
    private readonly events: EventsService,
    // 014 EARS-17/EARS-18 — the ONE shared idempotency record (012-design §6),
    // consumed by the fenced legacy commands exactly as 014's recordings surface consumes it.
    // Plain constructor injection, deliberately NOT `@Inject(IdempotencyService)`:
    // a parameter decorator makes the endpoint-authz gate's tsx transform drop
    // this class's `design:paramtypes`, so Nest then cannot resolve the
    // undecorated `EventsService` at index 0 and the BLOCK gate fails to boot.
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  @HttpCode(201)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    // Create is an authenticated admin write but not a lifecycle transition —
    // 007's audit_ledger obligation attaches to the transitions (EARS-4/5/6),
    // not to create — so it does not owe a terminal auth-audit row (low-stakes).
    audit: "low-stakes",
    tests: ["EARS-1", "EARS-8"],
  })
  async create(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<EventAdminDetail> {
    const { payloadRaw, pdf } = await this.readMultipart(req);
    if (payloadRaw === undefined) {
      throw new BadRequestException("missing 'payload' form field");
    }
    const parsed = CreateEventRequestSchema.safeParse(
      this.parseJson(payloadRaw),
    );
    if (!parsed.success) {
      throw new BadRequestException({
        message: "invalid event payload",
        issues: parsed.error.issues,
      });
    }
    // #1593 — the 201 already carries the aggregate, so it also carries the
    // validator for it: a client that creates then immediately transitions must
    // not have to re-read the detail just to obtain an `If-Match`.
    return this.withETag(reply, await this.events.create(parsed.data, pdf));
  }

  /**
   * #1593 — stamp the aggregate's optimistic-concurrency validator on the
   * response and return the body unchanged. Every admin response that carries an
   * `EventAdminDetail` goes through here, so the header and the body's `version`
   * are derived from ONE value and cannot drift apart. The weak form `W/"<n>"`
   * is the house contract (`taxonomyETag`, shared with 012's taxonomy surface and
   * 014's recordings surface): the validator asserts the aggregate's revision,
   * not a byte-exact representation, so a signed-URL field that differs per read
   * must not invalidate it.
   */
  private withETag(
    reply: FastifyReply,
    detail: EventAdminDetail,
  ): EventAdminDetail {
    void reply.header("etag", taxonomyETag(detail.version));
    return detail;
  }

  /**
   * #1593 — the precondition the six lifecycle commands carry, in the contract
   * 014's recordings surface already established. Absent or blank is 428
   * `PRECONDITION_REQUIRED`; present but not a validator this API issued is 412
   * `PRECONDITION_FAILED`, because a syntactically unusable validator asserts
   * nothing and therefore cannot pass — treating it as «no precondition» would
   * turn a malformed header into a bypass of the whole mechanism.
   *
   * Raised as a `TaxonomyError` and re-shaped by {@link withProtocolRefusalShape}
   * onto THIS surface's `{ code, message }` body: the codes are the shared ones,
   * the envelope stays the events surface's own.
   *
   * @returns the raw header (it joins a fenced command idempotency fingerprint —
   * the same key against a different validator is a different bound request) and
   * the parsed version.
   */
  private requireIfMatch(req: FastifyRequest): { raw: string; version: number } {
    const raw = req.headers[IF_MATCH_HEADER] as string | undefined;
    if (!raw || raw.trim().length === 0) {
      throw new TaxonomyError(
        "PRECONDITION_REQUIRED",
        "an event lifecycle command must carry the If-Match of the version it was read at",
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

  /**
   * Read the shared `multipart/form-data` authoring body — a `payload` JSON field
   * plus an optional `programPdf` file (create EARS-1 / edit EARS-2). The JSON+file
   * shape does not fit `@Body()` DTO validation, so the payload is Zod-parsed by
   * each command; the file is validated (size + `application/pdf`) here before it
   * reaches object storage. An unexpected file part is drained, never stored.
   */
  private async readMultipart(
    req: FastifyRequest,
  ): Promise<{ payloadRaw: string | undefined; pdf: UploadedPdf | undefined }> {
    if (typeof req.isMultipart !== "function" || !req.isMultipart()) {
      throw new BadRequestException("multipart/form-data is required");
    }
    let payloadRaw: string | undefined;
    let pdf: UploadedPdf | undefined;
    for await (const part of req.parts()) {
      if (part.type === "file") {
        if (part.fieldname !== "programPdf") {
          await part.toBuffer(); // drain an unexpected file part
          continue;
        }
        const body = await part.toBuffer();
        if (body.length === 0) continue;
        if (body.length > MAX_PDF_BYTES) {
          throw new BadRequestException("program PDF exceeds the size limit");
        }
        if (part.mimetype !== "application/pdf") {
          throw new BadRequestException("the program file must be a PDF");
        }
        pdf = { filename: part.filename, contentType: part.mimetype, body };
      } else if (part.fieldname === "payload") {
        payloadRaw = String(part.value);
      }
    }
    return { payloadRaw, pdf };
  }

  /** Parse a form `payload` field as JSON, mapping a malformed body to a 400. */
  private parseJson(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      throw new BadRequestException("'payload' is not valid JSON");
    }
  }

  /**
   * EARS-2 — `UpdateEvent` (`PATCH /v1/admin/events/:id`): edit an event's
   * authored fields at any **pre-hide** state and, when a replacement
   * `programPdf` rides the same multipart request, supersede the stored object
   * reference so the 004 public page serves the **current** file (the superseded
   * file is no longer served). The operator never has to unpublish to correct a
   * detail — an edit is not a state reversal (there is no `published → draft`,
   * EARS-7). `payload` is optional (a PDF-only replacement carries no field
   * edits); a present payload is validated against the `@ds/schemas` partial SSOT
   * — a bad field (e.g. a non-МСК datetime) is a 400 and nothing is mutated. An
   * edit to a `hidden` event is a 409 ({@link EventNotEditableError}). A
   * missing event id is a 404. `platform_admin`-only (EARS-8); like create it is a
   * `platform_admin` authoring write, not a lifecycle transition, so it owes no
   * terminal `audit_ledger` row (that obligation attaches to EARS-4/5/6).
   */
  @Patch(":id")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "low-stakes",
    tests: ["EARS-2", "EARS-8"],
  })
  async update(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<EventAdminDetail> {
    const { payloadRaw, pdf } = await this.readMultipart(req);
    // `payload` is optional on an edit: a PDF-only replacement carries no fields,
    // so an absent payload is an empty patch, not a 400.
    const parsed = UpdateEventRequestSchema.safeParse(
      payloadRaw === undefined ? {} : this.parseJson(payloadRaw),
    );
    if (!parsed.success) {
      throw new BadRequestException({
        message: "invalid event payload",
        issues: parsed.error.issues,
      });
    }
    try {
      const updated = await this.events.update(id, parsed.data, pdf);
      if (!updated) throw new NotFoundException("event not found");
      return this.withETag(reply, updated);
    } catch (err) {
      if (err instanceof EventNotEditableError) {
        throw new ConflictException({
          message: "event is hidden — editing is refused",
          state: err.state,
        });
      }
      throw err;
    }
  }

  @Get()
  @ApiQuery({ name: "q", required: false, type: String, maxLength: 160 })
  @ApiQuery({ name: "page", required: false, type: Number, minimum: 1 })
  @ApiQuery({
    name: "pageSize",
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
  })
  @ApiOkResponse({ type: EventAdminListDto })
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-8"],
  })
  list(@Query() rawQuery: Record<string, string>): Promise<EventAdminList> {
    const parsed = EventAdminListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new TaxonomyError(
        "VALIDATION_FAILED",
        "invalid event list query",
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      );
    }
    return this.events.list(parsed.data);
  }

  @Get(":id")
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-8"],
  })
  async detail(
    @Param("id") id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<EventAdminDetail> {
    const found = await this.events.detail(id);
    if (!found) throw new NotFoundException("event not found");
    // #1593 — THE read that issues the validator: every lifecycle command's
    // `If-Match` is expected to be the `ETag` an operator's client received here.
    return this.withETag(reply, found);
  }

  /**
   * EARS-3 — `ConfigureStream` (`PUT /v1/admin/events/:id/stream`): record the
   * event's stream config from an **explicit** provider in the closed enum
   * `rutube | youtube` plus an embed reference. The provider enum is validated by
   * the `ZodValidationPipe` before this handler runs, so an unknown provider is a
   * 400 and no config is recorded for it (EARS-3). The write is an idempotent
   * upsert — one config per event — so a wrong reference is correctable while
   * `published` with no state reversal (US-3). Configuring outside the pre-air
   * window (design §2) is a 409. `platform_admin`-only (EARS-8). The 006 room
   * later instantiates the player from exactly this config, never sniffing the
   * URL. `PUT` because the resource is the single stream-config sub-resource of
   * the event (create-or-replace).
   */
  @Put(":id/stream")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    // A `platform_admin` authoring write, not a lifecycle transition — no
    // terminal `audit_ledger` row is owed (the audit obligation attaches to the
    // transitions, EARS-4/5/6), so it is low-stakes like create.
    audit: "low-stakes",
    tests: ["EARS-3", "EARS-8"],
  })
  async configureStream(
    @Param("id") id: string,
    @Body() dto: ConfigureStreamRequestDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<EventAdminDetail> {
    try {
      const updated = await this.events.configureStream(id, dto);
      if (!updated) throw new NotFoundException("event not found");
      return this.withETag(reply, updated);
    } catch (err) {
      if (err instanceof StreamNotConfigurableError) {
        throw new ConflictException({
          message: "stream config is not editable in the event's current state",
          state: err.state,
        });
      }
      // 014 EARS-27 (#1741) — `ConfigureStream` is a BROADCAST command, so it is
      // refused on a `legacy` эфир with the same 409 `INVALID_TRANSITION` every
      // other cross-machine command answers. It is not a transition, so the
      // refusal reaches here as a raw domain error rather than through the
      // transition path; without this mapping it would surface as a 500.
      throw asTransitionRefusal(err);
    }
  }

  /**
   * EARS-4 — `PublishEvent` (`POST /v1/admin/events/:id/publish`): the named
   * `draft → published` transition. It runs through the EARS-7 guard (publish is
   * refused with a 409 unless the event is in `draft`) and, on success, appends
   * exactly one terminal `audit_ledger` row keyed to the acting `platform_admin`
   * (ADR-0003 §6). Publishing is the single visibility signal — the event
   * becomes publicly reachable on 004 and 005 registration opens off the same
   * `EventLifecycleState`, with no second flag (EARS-9). Idempotent re-publish is
   * NOT offered: a second publish from `published` is a 409 (no self-transition),
   * matching the closed transition set.
   */
  @Post(":id/publish")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    // `audit` here is the endpoint-authz AUTH-audit tier (ADR-0001 §2.5/§8) — a
    // `platform_admin` write, not an auth security event, so it owes no
    // AuthAuditLog emission (low-stakes, as create/transition). The EARS-4
    // domain `audit_ledger` transition row is a separate ADR-0003 §6 obligation,
    // written atomically in the service — not this classification field.
    audit: "low-stakes",
    tests: ["EARS-4", "EARS-8"],
  })
  async publish(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<EventAdminDetail> {
    // #1593 — the precondition is evaluated before the command, so a caller with
    // no validator is told to read first rather than having its publish applied.
    const { version } = await withProtocolRefusalShape(async () =>
      this.requireIfMatch(req),
    );
    // The 003 session hook attaches the authenticated subject; the acting admin
    // `sub` keys the audit row (ADR-0003 §6). Null only if unresolved — the
    // AuthzGuard has already refused any unauthenticated caller (EARS-8).
    const actorSub = (req as { user?: { sub?: string } }).user?.sub ?? null;
    try {
      const updated = await this.events.publish(id, actorSub, version);
      if (!updated) throw new NotFoundException("event not found");
      return this.withETag(reply, updated);
    } catch (err) {
      // Every refusal — domain and precondition alike — goes through the ONE
      // mapper (#1593). Publish used to shape its own `InvalidTransitionError`
      // 409 here, and that body carried no `code`: the admin client reads the
      // stable code to decide whether a refused command means "your screen is
      // behind the row, re-read it", so an uncoded 409 left the operator on a
      // draft badge with an impossible publish button (the owner's Stage-B dead
      // end). There is no second refusal envelope on this controller.
      throw asTransitionRefusal(err);
    }
  }

  /**
   * EARS-5 — `OpenRoom` (`POST /v1/admin/events/:id/open`): the named
   * `published → live` transition, the director's air-day action that opens the
   * 006 room (admission of registered doctors + presence capture start). It runs
   * through the EARS-7 guard (open is refused with a 409 unless the event is in
   * `published`) and, on success, appends exactly one terminal `audit_ledger`
   * row keyed to the acting `platform_admin` (ADR-0003 §6). The `live` state is
   * the single source of truth the 006 room gates admission on (EARS-9).
   */
  @Post(":id/open")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    // Endpoint-authz AUTH-audit tier (ADR-0001 §2.5/§8): a `platform_admin`
    // write, not an auth security event — no AuthAuditLog emission (low-stakes).
    // The EARS-5 domain `audit_ledger` row is a separate ADR-0003 §6 obligation
    // written atomically in the service, not this classification field.
    audit: "low-stakes",
    tests: ["EARS-5", "EARS-8"],
  })
  async open(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<EventAdminDetail> {
    return this.namedTransition(id, req, reply, (eventId, actorSub, version) =>
      this.events.openRoom(eventId, actorSub, version),
    );
  }

  /**
   * EARS-5 — `CloseRoom` (`POST /v1/admin/events/:id/close`): the named
   * `live → ended` transition, the director's action that closes the 006 room
   * (admission + heartbeat/chat acceptance stop) and **bounds the presence
   * window** (006 EARS-7). It runs through the EARS-7 guard (close is refused
   * with a 409 unless the event is in `live`) and, on success, appends exactly
   * one terminal `audit_ledger` row keyed to the acting `platform_admin`
   * (ADR-0003 §6).
   */
  @Post(":id/close")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "low-stakes",
    tests: ["EARS-5", "EARS-8"],
  })
  async close(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<EventAdminDetail> {
    return this.namedTransition(id, req, reply, (eventId, actorSub, version) =>
      this.events.closeRoom(eventId, actorSub, version),
    );
  }

  /**
   * 014 EARS-25 (#1741) — `ArchiveLegacyBroadcast`
   * (`POST /v1/admin/events/:id/archive-legacy`, admin label «Архивировать»):
   * the LEGACY machine's `hidden → in_archive` transition. It publishes an эфир
   * the platform never hosted into the public archive, where it renders exactly
   * like an `ended` broadcast with a published recording (014-design §3.1).
   *
   * Not a state-switching variant of any 007 command: the legacy machine is a
   * separate machine keyed by `events.origin`, so this route exists precisely
   * BECAUSE «I closed the room I was running» and «this эфир happened before us»
   * are different operator assertions with different audit ids. The 007
   * `MarkEventEnded` fork this replaces is gone from the contract entirely.
   *
   * Refusals leave the state untouched and write no audit row: 409
   * `EVENT_NOT_FINISHED` when the эфир carries no published, non-retired
   * recording (there is nothing to archive), 409 `INVALID_TRANSITION` on a
   * `platform` event or from any state other than `hidden` (EARS-27).
   *
   * **Protocol** — identical to every fenced lifecycle command on this surface:
   * a canonical-UUID `Idempotency-Key` and an `If-Match` are both REQUIRED over
   * the ONE retained fenced record (012-design §6); see
   * {@link fencedTransition}.
   */
  @Post(":id/archive-legacy")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    // Endpoint-authz AUTH-audit tier (ADR-0001 §2.5/§8): a `platform_admin`
    // write, not an auth security event — no AuthAuditLog emission (low-stakes).
    // The domain `audit_ledger` row is a separate ADR-0003 §6 obligation written
    // atomically in the service.
    audit: "low-stakes",
    // #1304 default-deny: a brand-new admin mutation revalidates live, exactly
    // like the 014 sibling recordings commands.
    revalidate: "live",
    tests: ["EARS-25", "EARS-8"],
  })
  async archiveLegacy(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<EventAdminDetail> {
    return this.fencedTransition(
      id,
      req,
      reply,
      "archive-legacy",
      (eventId, actor, fence, version) =>
        this.events.archiveLegacy(eventId, actor, fence, version),
    );
  }

  /**
   * 014 EARS-25 (#1741) — `HideLegacyBroadcast`
   * (`POST /v1/admin/events/:id/hide-legacy`, admin label «Скрыть»): the LEGACY
   * machine's `in_archive → hidden` transition. The эфир leaves every listing,
   * tab and count and its direct link renders 004's hidden notice.
   *
   * Unlike 007's terminal `ended → hidden` this move is REVERSIBLE — the эфир
   * can be archived again — which is why it is its own route with its own audit
   * id rather than a reuse of `:id/hide`. The origin-keyed closed set does NOT
   * separate the two on its own — `in_archive → hidden` is a legal legacy edge,
   * so 007's terminal hide would otherwise land here — which is why `:id/hide`
   * carries the explicit machine guard (EARS-27).
   *
   * Its only refusal is 409 `INVALID_TRANSITION`: a `platform` event, or a
   * `legacy` эфир not currently `in_archive`. Same fenced protocol as its
   * sibling — see {@link fencedTransition}.
   */
  @Post(":id/hide-legacy")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    // Endpoint-authz AUTH-audit tier (ADR-0001 §2.5/§8): a `platform_admin`
    // write, not an auth security event — no AuthAuditLog emission (low-stakes).
    // The domain `audit_ledger` row is a separate ADR-0003 §6 obligation written
    // atomically in the service.
    audit: "low-stakes",
    // #1304 default-deny: a brand-new admin mutation revalidates live, exactly
    // like the 014 sibling recordings commands.
    revalidate: "live",
    tests: ["EARS-25", "EARS-8"],
  })
  async hideLegacy(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<EventAdminDetail> {
    return this.fencedTransition(
      id,
      req,
      reply,
      "hide-legacy",
      (eventId, actor, fence, version) =>
        this.events.hideLegacy(eventId, actor, fence, version),
    );
  }

  /**
   * The shared body of a FENCED lifecycle command (014-design §3.1): a
   * canonical-UUID `Idempotency-Key` AND an `If-Match` are both required, over
   * the ONE retained fenced record 012-design §6 owns — the same
   * `IdempotencyService` 014's recordings surface consumes, not a second
   * implementation.
   *
   * The order is: auth (guard) → key shape → `If-Match` presence/shape →
   * reserve/replay → command. The completion is enlisted in the transition's own
   * transaction, so a fenced-out owner rolls the state change and the audit row
   * back with it, and a deterministic 409 is fenced-stored so a retry replays
   * that exact refusal instead of re-deciding it.
   *
   * The two headers answer different questions and neither substitutes for the
   * other: the key makes a RETRY of this exact request safe, the validator makes
   * the request itself conditional on the revision the operator read. So the raw
   * `If-Match` joins the fingerprint — the same key replayed against a DIFFERENT
   * validator is a different bound request (a reuse), not a replay of this one.
   *
   * `command` is the route's last segment; it keys both the recorded route and
   * the fingerprint path, so one key cannot replay across two DIFFERENT commands
   * on the same event.
   */
  private async fencedTransition(
    id: string,
    req: FastifyRequest,
    reply: FastifyReply,
    command: string,
    run: (
      eventId: string,
      actor: string | null,
      fence: TransitionFence,
      expectedVersion: number,
    ) => Promise<EventAdminDetail | null>,
  ): Promise<EventAdminDetail> {
    const actor = actorSub(req);
    // The protocol refusals (428 key required, 400 malformed key, 409 reuse /
    // in-progress) are 012 `TaxonomyError`s. They are re-shaped onto THIS
    // surface's `{ code, message }` body rather than dragging 012's RFC 7807
    // filter onto a controller whose live sibling routes answer the other shape.
    let expectedVersion = 0;
    const outcome = await withProtocolRefusalShape(async () => {
      const key = this.idempotency.requireKey(
        req.headers[IDEMPOTENCY_KEY_HEADER],
      );
      // #1593 — the key's shape is checked first (it identifies the retry), then
      // the validator (it conditions the command). Both refusals precede any
      // record reservation, so a malformed request burns no key.
      const { raw: rawIfMatch, version } = this.requireIfMatch(req);
      expectedVersion = version;
      return this.idempotency.begin({
        key,
        scope: "events",
        actorId: actor,
        method: "POST",
        route: `/v1/admin/events/:id/${command}`,
        // The command has no body, so the concrete path plus the validator IS
        // the whole bound input: the same key against a different event — or
        // against a different revision of this one — is a reuse, not a replay.
        fingerprint: this.idempotency.fingerprint({
          method: "POST",
          path: `/v1/admin/events/${id}/${command}`,
          ifMatch: rawIfMatch,
        }),
      });
    });
    if (outcome.kind === "replay") {
      void reply.status(outcome.replay.status);
      return outcome.replay.body as EventAdminDetail;
    }

    try {
      const updated = await run(
        id,
        actor,
        (tx, detail) =>
          // The stored bytes ARE the bytes sent: the record is completed with the
          // very projection this handler returns, inside the transaction that
          // applies the transition.
          this.idempotency.complete(tx, outcome.lease, {
            status: 200,
            body: detail,
          }),
        expectedVersion,
      );
      if (!updated) throw new NotFoundException("event not found");
      return this.withETag(reply, updated);
    } catch (err) {
      throw await this.storeTransitionRefusal(outcome.lease, err);
    }
  }

  /**
   * Fenced-store a DETERMINISTIC refusal of a fenced command so a retry replays it
   * verbatim (012-design §6 bullet 3), and return the exception to throw.
   *
   * Only the contracted 409s qualify: each is a property of the bound
   * request against a row state, so an exact retry gets the same answer forever.
   * A 404 is deliberately excluded — the row may exist later, so the answer is
   * not a property of the request — and an unclassified fault is left
   * takeover-eligible rather than frozen into a verdict. A store failure never
   * suppresses the response: the record simply stays `processing`.
   */
  private async storeTransitionRefusal(
    lease: IdempotencyLease,
    err: unknown,
  ): Promise<unknown> {
    const refusal = asTransitionRefusal(err);
    if (refusal instanceof ConflictException) {
      try {
        await this.idempotency.storeTerminalOutcome(lease, {
          status: refusal.getStatus(),
          body: refusal.getResponse(),
        });
      } catch {
        // Logged by the service; the caller still gets its answer.
      }
    }
    return refusal;
  }

  /**
   * EARS-6 — `HideEvent` (`POST /v1/admin/events/:id/hide`): the named
   * `ended → hidden` transition, the operator's **manual** post-broadcast
   * action (LD-2 — no scheduler, no time-based automation fires it in wave 1).
   * It runs through the EARS-7 guard (hide is refused with a 409 unless the
   * event is in `ended`) and, on success, appends exactly one terminal
   * `audit_ledger` row keyed to the acting `platform_admin` (ADR-0003 §6). After
   * hide the event leaves all public surfaces off the same
   * `EventLifecycleState` (EARS-9): 004 drops it from the upcoming listing and
   * its public page degrades to the hidden notice (004 EARS-5, a consumer
   * slice). `hidden` is terminal — there is no reopen (EARS-7).
   */
  @Post(":id/hide")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    // Endpoint-authz AUTH-audit tier (ADR-0001 §2.5/§8): a `platform_admin`
    // write, not an auth security event — no AuthAuditLog emission (low-stakes).
    // The EARS-6 domain `audit_ledger` row is a separate ADR-0003 §6 obligation
    // written atomically in the service, not this classification field.
    audit: "low-stakes",
    tests: ["EARS-6", "EARS-8"],
  })
  async hide(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<EventAdminDetail> {
    return this.namedTransition(id, req, reply, (eventId, actorSub, version) =>
      this.events.hide(eventId, actorSub, version),
    );
  }

  /**
   * Shared body of the named, audited transition commands (publish / open /
   * close / hide — EARS-4/5/6): resolve the acting
   * admin `sub` off the request
   * (the 003
   * session hook attaches it; the `AuthzGuard` has already refused any
   * unauthenticated caller — EARS-8), enforce the #1593 `If-Match` precondition,
   * invoke the service command, map a missing event to a 404 and the EARS-7
   * guard's {@link InvalidTransitionError} to a 409 state conflict (state left
   * untouched, no audit row), and stamp the new validator on the response.
   */
  private async namedTransition(
    id: string,
    req: FastifyRequest,
    reply: FastifyReply,
    run: (
      id: string,
      actorSub: string | null,
      expectedVersion: number,
    ) => Promise<EventAdminDetail | null>,
  ): Promise<EventAdminDetail> {
    const { version } = await withProtocolRefusalShape(async () =>
      this.requireIfMatch(req),
    );
    try {
      const updated = await run(id, actorSub(req), version);
      if (!updated) throw new NotFoundException("event not found");
      return this.withETag(reply, updated);
    } catch (err) {
      throw asTransitionRefusal(err);
    }
  }

  /**
   * EARS-7 — the single closed-set lifecycle transition, server-enforced. Moves
   * the event to the target state iff `current → to` is one of the four legal
   * forward moves; an in-enum-but-out-of-order target (a skip-forward, any
   * backward move, reopening `hidden`, or the `published → draft` unpublish
   * the PRD names none) is refused with a 409 state conflict, never applied. A
   * target outside the closed enum is a 400 (the `ZodValidationPipe`, before the
   * guard). The four named transition commands + their side-effects / audit rows
   * are sibling handlers (EARS-4/5/6); this is the guard they all run through.
   */
  @Post(":id/transition")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    // The bare guarded state change carries no terminal audit row — that
    // obligation attaches to the named transition commands (EARS-4/5/6), each
    // of which appends exactly one `audit_ledger` row on top of this guard.
    audit: "low-stakes",
    tests: ["EARS-7", "EARS-8"],
  })
  async transition(
    @Param("id") id: string,
    @Body() dto: TransitionEventRequestDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<EventAdminDetail> {
    // #1593 — the bare guarded command carries the SAME precondition as the
    // named ones. Exempting it would leave the closed-set guard reachable by a
    // caller holding a read of any age, which is exactly the lost update the
    // named commands now refuse.
    const { version } = await withProtocolRefusalShape(async () =>
      this.requireIfMatch(req),
    );
    try {
      const updated = await this.events.transition(id, dto.to, version);
      if (!updated) throw new NotFoundException("event not found");
      return this.withETag(reply, updated);
    } catch (err) {
      throw asTransitionRefusal(err);
    }
  }
}

/**
 * Map a domain transition refusal onto its 409, or return the error untouched
 * for the global filter. The refusal CODES are the ones 014-design §3.1 + §11
 * name — `EVENT_NOT_FINISHED` (nothing published to archive) and
 * `INVALID_TRANSITION` (an edge absent from the event's own machine) — and
 * they are emitted from one place so the bare EARS-7 command and every named
 * command answer the same body for the same domain refusal.
 */
/**
 * The acting admin's Zitadel `sub` — the actor half of both the audit row
 * (ADR-0003 §6) and the idempotency record's identity binding. Null only if
 * unresolved; the `AuthzGuard` has already refused any unauthenticated caller.
 */
function actorSub(req: FastifyRequest): string | null {
  return (req as { user?: { sub?: string } }).user?.sub ?? null;
}

/**
 * Run the 012 idempotency protocol preamble and re-shape its `TaxonomyError`
 * refusals onto the 007 admin surface's `{ code, message }` body — same status,
 * same stable code, this controller's envelope. The alternative (applying
 * `TaxonomyProblemFilter` here) would silently reshape four live sibling routes,
 * which that filter's own doc rules out.
 */
async function withProtocolRefusalShape<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof TaxonomyError) {
      throw new HttpException(
        { code: err.errorCode, message: err.detail ?? err.message },
        err.getStatus(),
      );
    }
    throw err;
  }
}

function asTransitionRefusal(err: unknown): unknown {
  // 014 EARS-25 (#1741) — the archive gate's refusal. The same code 014 §3
  // already uses for «this event is not in a state where a recording may be
  // published», read from the other direction: nothing published to archive.
  if (err instanceof EventNotFinishedError) {
    return new ConflictException({
      code: "EVENT_NOT_FINISHED",
      message: "event has no published recording to archive",
      eventId: err.eventId,
    });
  }
  if (err instanceof InvalidTransitionError) {
    return new ConflictException({
      code: "INVALID_TRANSITION",
      message: "illegal lifecycle transition",
      from: err.from,
      to: err.to,
    });
  }
  // #1593 — the stale-validator refusal. Emitted from the same one place as the
  // domain refusals so every command answers the same body for it, and NOT
  // fenced-stored by a fenced command: unlike the domain 409s it is not a property of
  // the bound request against a row state — re-reading and retrying is exactly
  // what the caller is being told to do, so freezing it into the record would
  // make the correct next request unanswerable under that key.
  if (err instanceof EventVersionConflictError) {
    return new PreconditionFailedException({
      code: "PRECONDITION_FAILED",
      message: "the event changed since it was read; reload and retry",
    });
  }
  return err;
}

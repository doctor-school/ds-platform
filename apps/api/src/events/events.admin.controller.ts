import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  CreateEventRequestSchema,
  type EventAdminDetail,
  type EventAdminList,
  UpdateEventRequestSchema,
} from "@ds/schemas";
import { Authz } from "../authz/index.js";
import {
  ConfigureStreamRequestDto,
  TransitionEventRequestDto,
} from "./events.dto.js";
import {
  EventNotEditableError,
  EventsService,
  InvalidTransitionError,
  StreamNotConfigurableError,
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
  constructor(private readonly events: EventsService) {}

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
  async create(@Req() req: FastifyRequest): Promise<EventAdminDetail> {
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
    return this.events.create(parsed.data, pdf);
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
   * authored fields at any **pre-archive** state and, when a replacement
   * `programPdf` rides the same multipart request, supersede the stored object
   * reference so the 004 public page serves the **current** file (the superseded
   * file is no longer served). The operator never has to unpublish to correct a
   * detail — an edit is not a state reversal (there is no `published → draft`,
   * EARS-7). `payload` is optional (a PDF-only replacement carries no field
   * edits); a present payload is validated against the `@ds/schemas` partial SSOT
   * — a bad field (e.g. a non-МСК datetime) is a 400 and nothing is mutated. An
   * edit to an `archived` event is a 409 ({@link EventNotEditableError}). A
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
      return updated;
    } catch (err) {
      if (err instanceof EventNotEditableError) {
        throw new ConflictException({
          message: "event is archived — editing is refused",
          state: err.state,
        });
      }
      throw err;
    }
  }

  @Get()
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-8"],
  })
  list(): Promise<EventAdminList> {
    return this.events.list();
  }

  @Get(":id")
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-8"],
  })
  async detail(@Param("id") id: string): Promise<EventAdminDetail> {
    const found = await this.events.detail(id);
    if (!found) throw new NotFoundException("event not found");
    return found;
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
  ): Promise<EventAdminDetail> {
    try {
      const updated = await this.events.configureStream(id, dto);
      if (!updated) throw new NotFoundException("event not found");
      return updated;
    } catch (err) {
      if (err instanceof StreamNotConfigurableError) {
        throw new ConflictException({
          message: "stream config is not editable in the event's current state",
          state: err.state,
        });
      }
      throw err;
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
  ): Promise<EventAdminDetail> {
    // The 003 session hook attaches the authenticated subject; the acting admin
    // `sub` keys the audit row (ADR-0003 §6). Null only if unresolved — the
    // AuthzGuard has already refused any unauthenticated caller (EARS-8).
    const actorSub = (req as { user?: { sub?: string } }).user?.sub ?? null;
    try {
      const updated = await this.events.publish(id, actorSub);
      if (!updated) throw new NotFoundException("event not found");
      return updated;
    } catch (err) {
      if (err instanceof InvalidTransitionError) {
        throw new ConflictException({
          message: "event is not in draft — publish is refused",
          from: err.from,
          to: err.to,
        });
      }
      throw err;
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
  ): Promise<EventAdminDetail> {
    return this.namedTransition(id, req, (eventId, actorSub) =>
      this.events.openRoom(eventId, actorSub),
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
  ): Promise<EventAdminDetail> {
    return this.namedTransition(id, req, (eventId, actorSub) =>
      this.events.closeRoom(eventId, actorSub),
    );
  }

  /**
   * EARS-6 — `ArchiveEvent` (`POST /v1/admin/events/:id/archive`): the named
   * `ended → archived` transition, the operator's **manual** post-broadcast
   * action (LD-2 — no scheduler, no time-based automation fires it in wave 1).
   * It runs through the EARS-7 guard (archive is refused with a 409 unless the
   * event is in `ended`) and, on success, appends exactly one terminal
   * `audit_ledger` row keyed to the acting `platform_admin` (ADR-0003 §6). After
   * archive the event leaves all public surfaces off the same
   * `EventLifecycleState` (EARS-9): 004 drops it from the upcoming listing and
   * its public page degrades to the archived notice (004 EARS-5, a consumer
   * slice). `archived` is terminal — there is no reopen (EARS-7).
   */
  @Post(":id/archive")
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
  async archive(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
  ): Promise<EventAdminDetail> {
    return this.namedTransition(id, req, (eventId, actorSub) =>
      this.events.archive(eventId, actorSub),
    );
  }

  /**
   * Shared body of the named, audited transition commands (publish / open /
   * close / archive — EARS-4/5/6): resolve the acting admin `sub` off the request
   * (the 003
   * session hook attaches it; the `AuthzGuard` has already refused any
   * unauthenticated caller — EARS-8), invoke the service command, map a missing
   * event to a 404 and the EARS-7 guard's {@link InvalidTransitionError} to a
   * 409 state conflict (state left untouched, no audit row).
   */
  private async namedTransition(
    id: string,
    req: FastifyRequest,
    run: (
      id: string,
      actorSub: string | null,
    ) => Promise<EventAdminDetail | null>,
  ): Promise<EventAdminDetail> {
    // The acting admin `sub` keys the audit row (ADR-0003 §6). Null only if
    // unresolved — the AuthzGuard has already refused any unauthenticated caller.
    const actorSub = (req as { user?: { sub?: string } }).user?.sub ?? null;
    try {
      const updated = await run(id, actorSub);
      if (!updated) throw new NotFoundException("event not found");
      return updated;
    } catch (err) {
      if (err instanceof InvalidTransitionError) {
        throw new ConflictException({
          message: "illegal lifecycle transition",
          from: err.from,
          to: err.to,
        });
      }
      throw err;
    }
  }

  /**
   * EARS-7 — the single closed-set lifecycle transition, server-enforced. Moves
   * the event to the target state iff `current → to` is one of the four legal
   * forward moves; an in-enum-but-out-of-order target (a skip-forward, any
   * backward move, reopening `archived`, or the `published → draft` unpublish
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
  ): Promise<EventAdminDetail> {
    try {
      const updated = await this.events.transition(id, dto.to);
      if (!updated) throw new NotFoundException("event not found");
      return updated;
    } catch (err) {
      if (err instanceof InvalidTransitionError) {
        throw new ConflictException({
          message: "illegal lifecycle transition",
          from: err.from,
          to: err.to,
        });
      }
      throw err;
    }
  }
}

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  CreateEventRequestSchema,
  type EventAdminDetail,
  type EventAdminList,
} from "@ds/schemas";
import { Authz } from "../authz/index.js";
import { TransitionEventRequestDto } from "./events.dto.js";
import {
  EventsService,
  InvalidTransitionError,
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
        pdf = {
          filename: part.filename,
          contentType: part.mimetype,
          body,
        };
      } else if (part.fieldname === "payload") {
        payloadRaw = String(part.value);
      }
    }

    if (payloadRaw === undefined) {
      throw new BadRequestException("missing 'payload' form field");
    }
    let json: unknown;
    try {
      json = JSON.parse(payloadRaw);
    } catch {
      throw new BadRequestException("'payload' is not valid JSON");
    }
    const parsed = CreateEventRequestSchema.safeParse(json);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "invalid event payload",
        issues: parsed.error.issues,
      });
    }

    return this.events.create(parsed.data, pdf);
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

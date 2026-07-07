import {
  BadRequestException,
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
import { EventsService, type UploadedPdf } from "./events.service.js";

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
}

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiQuery,
  ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import {
  type CongressSubmission,
  CongressSubmissionCreateRequestSchema,
  CongressSubmissionDraftContentSchema,
  CongressSubmissionRefusalSchema,
  CongressSubmissionSchema,
  type CongressSubmissionSection,
  CongressSubmissionSectionSchema,
  CongressSubmissionSendRequestSchema,
  CongressSubmissionWithdrawRequestSchema,
} from "@ds/schemas";
import { Authz } from "../authz/index.js";
import { CongressSubmissionsService } from "./congress-submissions.service.js";

export class CongressSubmissionCreateRequestDto extends createZodDto(
  CongressSubmissionCreateRequestSchema,
) {}
export class CongressSubmissionDraftContentDto extends createZodDto(
  CongressSubmissionDraftContentSchema,
) {}
export class CongressSubmissionSendRequestDto extends createZodDto(
  CongressSubmissionSendRequestSchema,
) {}
export class CongressSubmissionWithdrawRequestDto extends createZodDto(
  CongressSubmissionWithdrawRequestSchema,
) {}
export class CongressSubmissionDto extends createZodDto(
  CongressSubmissionSchema,
) {}
export class CongressSubmissionSectionDto extends createZodDto(
  CongressSubmissionSectionSchema,
) {}
export class CongressSubmissionRefusalDto extends createZodDto(
  CongressSubmissionRefusalSchema,
) {}

const EventQuerySchema = z.uuid();

function subjectOf(req: FastifyRequest): string {
  const sub = (req as { user?: { sub?: string } }).user?.sub;
  if (!sub) throw new UnauthorizedException("authentication required");
  return sub;
}

/**
 * 046 EARS-5…EARS-13, EARS-16, EARS-17 (#2433) — the author's congress
 * submissions, `/v1/me/congress-submissions*` (046-design «Send cascade»,
 * «Authorization boundary»).
 *
 * Self-scoped by construction: the subject is always the session `sub` and
 * every row read or written is filtered by it, so no caller reaches another
 * account's submission (it is «not found»). Hence `authenticated` /
 * `doctor_guest` / `fast-path`: the role claim is the whole authorization, the
 * ownership is the query. The writes are `low-stakes`: the 010 capture trigger
 * audits each row change in the request's context; none is an auth/security
 * event. Every route is per-caller ⇒ `no-store`.
 *
 * Refusals carry `{problems: [{code, field?, params?}]}` — 422 for an unmet
 * send condition, 409 for a status the action does not apply to.
 */
@Controller({ path: "me/congress-submissions", version: "1" })
export class CongressSubmissionsMeController {
  constructor(
    @Inject(CongressSubmissionsService)
    private readonly submissions: CongressSubmissionsService,
  ) {}

  /**
   * EARS-4, EARS-5, EARS-10, EARS-11 — the section; without `event`, the
   * congress event's section; 404 for an event with no congress section.
   */
  @Get()
  @Header("Cache-Control", "no-store")
  @ApiQuery({ name: "event", required: false })
  @ApiOkResponse({ type: CongressSubmissionSectionDto })
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-5", "EARS-11"],
  })
  async section(
    @Req() req: FastifyRequest,
    @Query("event") event?: string,
  ): Promise<CongressSubmissionSection> {
    const sub = subjectOf(req);
    if (event === undefined) return this.submissions.section(sub, null);
    const eventId = EventQuerySchema.safeParse(event);
    if (!eventId.success) throw new BadRequestException("event must be a uuid");
    return this.submissions.section(sub, eventId.data);
  }

  /** EARS-5, EARS-6 — create a draft; 422 without a registration or after closing. */
  @Post()
  @HttpCode(201)
  @Header("Cache-Control", "no-store")
  @ApiCreatedResponse({ type: CongressSubmissionDto })
  @ApiUnprocessableEntityResponse({ type: CongressSubmissionRefusalDto })
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    check: "fast-path",
    audit: "low-stakes",
    tests: ["EARS-5", "EARS-6"],
  })
  async create(
    @Req() req: FastifyRequest,
    @Body() body: CongressSubmissionCreateRequestDto,
  ): Promise<CongressSubmission> {
    return this.submissions.create(subjectOf(req), body);
  }

  /** EARS-7 — autosave; 409 on a submission that is not editable. */
  @Patch(":id")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: CongressSubmissionDto })
  @ApiConflictResponse({ type: CongressSubmissionRefusalDto })
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    check: "fast-path",
    audit: "low-stakes",
    tests: ["EARS-7"],
  })
  async autosave(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() body: CongressSubmissionDraftContentDto,
  ): Promise<CongressSubmission> {
    return this.submissions.autosave(subjectOf(req), id, body);
  }

  /** EARS-9, EARS-16, EARS-17 — send; 422 naming every unmet condition. */
  @Post(":id/send")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: CongressSubmissionDto })
  @ApiUnprocessableEntityResponse({ type: CongressSubmissionRefusalDto })
  @ApiConflictResponse({ type: CongressSubmissionRefusalDto })
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    check: "fast-path",
    audit: "low-stakes",
    tests: ["EARS-9", "EARS-16", "EARS-17"],
  })
  async send(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() body: CongressSubmissionSendRequestDto,
  ): Promise<CongressSubmission> {
    return this.submissions.send(subjectOf(req), id, body);
  }

  /** EARS-12 — take back or withdraw; 409 when not allowed or the status moved. */
  @Post(":id/withdraw")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: CongressSubmissionDto })
  @ApiConflictResponse({ type: CongressSubmissionRefusalDto })
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    check: "fast-path",
    audit: "low-stakes",
    tests: ["EARS-12"],
  })
  async withdraw(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() body: CongressSubmissionWithdrawRequestDto,
  ): Promise<CongressSubmission> {
    return this.submissions.withdraw(subjectOf(req), id, body);
  }

  /** EARS-13 — delete a draft; 409 for any other status. */
  @Delete(":id")
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiConflictResponse({ type: CongressSubmissionRefusalDto })
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    check: "fast-path",
    audit: "low-stakes",
    tests: ["EARS-13"],
  })
  async remove(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
  ): Promise<void> {
    await this.submissions.remove(subjectOf(req), id);
  }
}

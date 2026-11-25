import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiQuery,
  ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { createZodDto } from "nestjs-zod";
import {
  ApplicantApplicationListSchema,
  ApplicantApplicationsQuerySchema,
  type ApplicantApplicationList,
  ApplicationRefusalSchema,
  AuthorApplicationIntakeResultSchema,
  AuthorApplicationIntakeSchema,
  type AuthorApplicationIntakeResult,
} from "@ds/schemas";

import { Authz } from "../authz/index.js";
import { BotProtected } from "../bot-protection/index.js";
import { ApplicationsService } from "./applications.service.js";

export class AuthorApplicationIntakeDto extends createZodDto(
  AuthorApplicationIntakeSchema,
) {}
export class AuthorApplicationIntakeResultDto extends createZodDto(
  AuthorApplicationIntakeResultSchema,
) {}
export class ApplicantApplicationListDto extends createZodDto(
  ApplicantApplicationListSchema,
) {}
export class ApplicationRefusalDto extends createZodDto(
  ApplicationRefusalSchema,
) {}

function subjectOf(req: FastifyRequest): string {
  const sub = (req as { user?: { sub?: string } }).user?.sub;
  if (!sub) throw new UnauthorizedException("authentication required");
  return sub;
}

/**
 * 033 EARS-6, EARS-7, EARS-10 — the signed-in applicant's intake and read into the shared
 * application queue, `/v1/me/applications/*` (033-design «Endpoints»).
 *
 * Self-scoped by construction: the applicant is always the session `sub`, so
 * the role claim is the whole authorization (`authenticated` / `doctor_guest`
 * / `fast-path`, the 046 me-cabinet precedent). `@BotProtected("application")`
 * gates it although it is signed in, so every intake of the queue carries the
 * 003 proof (033-design «Lead decisions» 10). The write is `low-stakes`: the
 * 010 capture trigger audits it in the request's context with the queue's PD
 * columns masked (EARS-25). Per-caller ⇒ `no-store`.
 */
@Controller({ path: "me/applications", version: "1" })
export class ApplicationsMeController {
  constructor(
    @Inject(ApplicationsService)
    private readonly applications: ApplicationsService,
  ) {}

  /** EARS-6, EARS-7 — submit an author application; replay-safe per key. */
  @Post("author")
  @BotProtected("application")
  @HttpCode(201)
  @Header("Cache-Control", "no-store")
  @ApiCreatedResponse({ type: AuthorApplicationIntakeResultDto })
  @ApiBadRequestResponse({ type: ApplicationRefusalDto })
  @ApiUnprocessableEntityResponse({ type: ApplicationRefusalDto })
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    check: "fast-path",
    audit: "low-stakes",
    tests: ["EARS-6", "EARS-7"],
  })
  async submitAuthor(
    @Req() req: FastifyRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: AuthorApplicationIntakeDto,
  ): Promise<AuthorApplicationIntakeResult> {
    const sub = subjectOf(req);
    const key = this.applications.requireKey(idempotencyKey);
    return this.applications.submitAuthor(sub, key, body);
  }

  /**
   * EARS-10 — the caller's own author applications that are not closed,
   * newest first, each only as «received». A read of the caller's own rows:
   * the session `sub` is the whole scope, it writes nothing.
   */
  @Get()
  @Header("Cache-Control", "no-store")
  @ApiQuery({ name: "kind", enum: ["author"], required: true })
  @ApiOkResponse({ type: ApplicantApplicationListDto })
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    check: "fast-path",
    audit: "none",
    revalidate: "none",
    tests: ["EARS-10"],
  })
  async listOwn(
    @Req() req: FastifyRequest,
    @Query() rawQuery: Record<string, string>,
  ): Promise<ApplicantApplicationList> {
    const sub = subjectOf(req);
    const parsed = ApplicantApplicationsQuerySchema.safeParse(rawQuery);
    if (!parsed.success)
      throw new BadRequestException({
        message: "invalid applications query",
        issues: parsed.error.issues,
      });
    return this.applications.listOwnAuthor(sub);
  }
}

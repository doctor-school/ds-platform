import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Param,
  Put,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ApiOkResponse } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import {
  type CongressAttendanceResponse,
  CongressAttendanceParamsSchema,
  CongressAttendanceRequestSchema,
  CongressAttendanceResponseSchema,
} from "@ds/schemas";
import type { AdminSessionPrincipal } from "../auth/admin-session/admin-session.service.js";
import { Authz, EventGrantPolicy } from "../authz/index.js";
import { CongressAttendanceService } from "./congress-attendance.service.js";

/** Body of the attendance mark (044 EARS-34). */
export class CongressAttendanceRequestDto extends createZodDto(
  CongressAttendanceRequestSchema,
) {}

/** Response of the attendance mark (044 EARS-34). */
export class CongressAttendanceResponseDto extends createZodDto(
  CongressAttendanceResponseSchema,
) {}

/**
 * 044 EARS-34 — the registrar marks (or clears) one participant's attendance on
 * one congress day, on the desk-route family the roster opened
 * (`event-roster.admin.controller.ts`).
 *
 * The authorization row is the desk registration's: `check: "policy"` +
 * {@link EventGrantPolicy.assertEventAccess} (EARS-38 — the role admits the
 * principal, the binding admits the event), `audit: "high-stakes"` and
 * `revalidate: "live"` because it is a WRITE (#1304, ADR-0001 A1). The 010
 * interceptor attributes the `registration_attendance` ledger row to the
 * acting registrar with source `admin-ui`.
 */
@Controller({ path: "admin/events", version: "1" })
export class AttendanceAdminController {
  // Explicit @Inject tokens — the API boots under `tsx`, which emits no
  // `design:paramtypes`.
  constructor(
    @Inject(CongressAttendanceService)
    private readonly attendance: CongressAttendanceService,
    @Inject(EventGrantPolicy) private readonly grants: EventGrantPolicy,
  ) {}

  /**
   * `PUT /v1/admin/events/:idOrSlug/registrations/:registrationId/attendance/:day`
   *
   * 200 with the day's value after the write — also when the write changed
   * nothing (idempotent; no ledger row then). 400 for a malformed id, date or
   * body; 422 `CONGRESS_DAY_UNKNOWN` for a date that is not a configured
   * congress day; 404 for a registration that is not one of this event's.
   */
  @Put(":idOrSlug/registrations/:registrationId/attendance/:day")
  @HttpCode(200)
  @ApiOkResponse({ type: CongressAttendanceResponseDto })
  @Authz({
    access: "authenticated",
    roles: ["platform_admin", "event-registrar"],
    check: "policy",
    audit: "high-stakes",
    // #1304 / ADR-0001 A1: a WRITE re-checks the principal (and its acting
    // grant) against the IdP on every call, like the desk registration.
    revalidate: "live",
    tests: ["EARS-34", "EARS-38"],
  })
  async mark(
    @Req() req: FastifyRequest,
    @Param("idOrSlug") idOrSlug: string,
    @Param("registrationId") registrationId: string,
    @Param("day") day: string,
    @Body() dto: CongressAttendanceRequestDto,
  ): Promise<CongressAttendanceResponse> {
    // EARS-38 — the event-binding step runs first, so a refused registrar
    // learns nothing from a 400, 404 or 422.
    const eventKey = await this.grants.assertEventAccess(
      (req as { user?: AdminSessionPrincipal }).user,
      idOrSlug,
    );
    const params = CongressAttendanceParamsSchema.safeParse({
      registrationId,
      day,
    });
    if (!params.success) {
      throw new BadRequestException({
        message: "invalid attendance path",
        issues: params.error.issues,
      });
    }
    return this.attendance.mark(
      eventKey,
      params.data.registrationId,
      params.data.day,
      dto.present,
    );
  }
}

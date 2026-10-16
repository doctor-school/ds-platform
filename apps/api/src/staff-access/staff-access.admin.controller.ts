import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
} from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import {
  StaffAccessGrantRequestSchema,
  StaffAccessGrantResponseSchema,
  StaffAccessListResponseSchema,
  StaffAccessRevokeRequestSchema,
  type StaffAccessGrantResponse,
  type StaffAccessListResponse,
} from "@ds/schemas";
import type { AdminSessionPrincipal } from "../auth/admin-session/admin-session.service.js";
import { IdpUnavailableError } from "../auth/idp/idp.types.js";
import { Authz } from "../authz/index.js";
import { StaffAccessService } from "./staff-access.service.js";

/** Body of `POST /v1/admin/staff-access/grants` (047 EARS-3). */
export class StaffAccessGrantRequestDto extends createZodDto(
  StaffAccessGrantRequestSchema,
) {}

/** Response of `POST /v1/admin/staff-access/grants` (047 EARS-6). */
export class StaffAccessGrantResponseDto extends createZodDto(
  StaffAccessGrantResponseSchema,
) {}

/** Body of `POST /v1/admin/staff-access/revocations` (047 EARS-7). */
export class StaffAccessRevokeRequestDto extends createZodDto(
  StaffAccessRevokeRequestSchema,
) {}

/** Response of `GET /v1/admin/staff-access` (047 EARS-2). */
export class StaffAccessListResponseDto extends createZodDto(
  StaffAccessListResponseSchema,
) {}

/** The IdP-fault answer every staff-access route shares (047-design §Endpoints). */
const UNAVAILABLE = "the service is temporarily unavailable";

/**
 * 047 — «Доступы»: the platform administrator's list, grant and revocation of
 * staff roles
 * (047-design §Endpoints). Every route is `platform_admin` only with live IdP
 * revalidation (EARS-1); the grant and the revocation also declare `stepUp` — a second factor no
 * older than 30 minutes, re-verified in the same session at `STEP_UP_URL`
 * (EARS-8). An IdP fault is `503`, which the console shows with «Повторить»,
 * never as a credential refusal or an empty list.
 */
@Controller({ path: "admin/staff-access", version: "1" })
export class StaffAccessAdminController {
  // Explicit @Inject tokens — the API boots under `tsx`, which emits no
  // `design:paramtypes`.
  constructor(
    @Inject(StaffAccessService) private readonly staff: StaffAccessService,
  ) {}

  /** `GET /v1/admin/staff-access` — every holder of a grantable role (EARS-2). */
  @Get()
  @ApiOkResponse({ type: StaffAccessListResponseDto })
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "none",
    tests: ["EARS-1", "EARS-2"],
  })
  async list(): Promise<StaffAccessListResponse> {
    return { items: await this.mapIdpFault(() => this.staff.list()) };
  }

  /**
   * `POST /v1/admin/staff-access/grants` — grant a staff role (EARS-3…EARS-6,
   * EARS-9). `201` with the row and, when this request set the account's
   * password, the temporary password — shown once, so the answer is `no-store`.
   * A refusal (EARS-3) is a `409`/`422` with an `errorCode`, nothing changed.
   */
  @Post("grants")
  @HttpCode(201)
  @ApiCreatedResponse({ type: StaffAccessGrantResponseDto })
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    stepUp: true,
    audit: "high-stakes",
    tests: ["EARS-3", "EARS-4", "EARS-5", "EARS-6", "EARS-8", "EARS-9"],
  })
  async grant(
    @Body() dto: StaffAccessGrantRequestDto,
    @Req() req: { user?: AdminSessionPrincipal },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StaffAccessGrantResponse> {
    const caller = req.user;
    if (!caller) throw new UnauthorizedException();
    reply.header("Cache-Control", "no-store");
    return this.mapIdpFault(() => this.staff.grant(dto, caller.sub));
  }

  /**
   * `POST /v1/admin/staff-access/revocations` — revoke a staff role (EARS-7,
   * EARS-9). `204` once the revocation is complete. A refusal is a `403` (own
   * `platform_admin`) or `409` (already revoked) with an `errorCode`; an IdP
   * fault is `503` after the person's admin sessions were still ended, and the
   * same request repeated finishes it.
   */
  @Post("revocations")
  @HttpCode(204)
  @ApiNoContentResponse()
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    stepUp: true,
    audit: "high-stakes",
    tests: ["EARS-7", "EARS-8", "EARS-9"],
  })
  async revoke(
    @Body() dto: StaffAccessRevokeRequestDto,
    @Req() req: { user?: AdminSessionPrincipal },
  ): Promise<void> {
    const caller = req.user;
    if (!caller) throw new UnauthorizedException();
    await this.mapIdpFault(() => this.staff.revoke(dto, caller.sub));
  }

  private async mapIdpFault<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      if (err instanceof IdpUnavailableError) {
        throw new ServiceUnavailableException(UNAVAILABLE);
      }
      throw err;
    }
  }
}

import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { createZodDto } from "nestjs-zod";
import { type DrizzleHandle, users } from "@ds/db";
import { type PointsAccount, PointsAccountSchema } from "@ds/schemas";
import { and, eq, isNull } from "drizzle-orm";
import { Authz } from "../authz/index.js";
import type { Role } from "../authz/authz.types.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { PointsLedgerService } from "./points-ledger.service.js";

/** The `PointsAccount` read model (025 EARS-2, EARS-30). */
export class PointsAccountDto extends createZodDto(PointsAccountSchema) {}

/** Same account audience as the sibling `/v1/me/*` reads (003, #2456). */
const ACCOUNT_ROLES: Role[] = ["doctor_guest", "platform_admin"];

/**
 * 025 EARS-2 (#3813) — `GET /v1/me/points`: the CALLER's own `PointsAccount`,
 * a fold over postings (025-design §1). The person is always the session
 * subject's `users.id`; the route takes no person identifier, and a request
 * that names another person (`?personId=`) is refused with 403, never served
 * the caller's or the named account. Unauthenticated → 401 from the global
 * `AuthzGuard`; a session subject with no live `users` row → 401. Per-caller ⇒
 * `Cache-Control: no-store`.
 */
@Controller({ path: "me/points", version: "1" })
export class PointsMeController {
  // Explicit @Inject tokens — the API boots under `tsx`, which emits no
  // `design:paramtypes`.
  constructor(
    @Inject(PointsLedgerService) private readonly ledger: PointsLedgerService,
    @Inject(DRIZZLE_DB) private readonly db: DrizzleHandle["db"],
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: PointsAccountDto })
  @Authz({
    access: "authenticated",
    roles: ACCOUNT_ROLES,
    check: "fast-path",
    audit: "none",
    tests: ["EARS-2"],
  })
  async read(
    @Req() req: FastifyRequest,
    @Query("personId") requested?: string,
  ): Promise<PointsAccount> {
    const sub = (req as { user?: { sub?: string } }).user?.sub;
    if (!sub) throw new UnauthorizedException("authentication required");
    const [person] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.zitadelSub, sub), isNull(users.deactivatedAt)));
    if (!person) throw new UnauthorizedException("authentication required");
    if (requested !== undefined && requested !== person.id) {
      throw new ForbiddenException("another person's points account");
    }
    return this.ledger.readPersonAccount(person.id);
  }
}

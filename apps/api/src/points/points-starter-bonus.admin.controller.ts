import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  UseFilters,
} from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { createZodDto } from "nestjs-zod";
import {
  type PointsStarterBonusRun,
  PointsStarterBonusRunSchema,
  RunPointsStarterBonusRequestSchema,
} from "@ds/schemas";
import { Authz } from "../authz/index.js";
import { PointsProblemFilter } from "./points.problem-filter.js";
import { PointsStarterBonusService } from "./points-starter-bonus.service.js";

/** Body of a starter-bonus run (025 EARS-43). */
export class RunPointsStarterBonusRequestDto extends createZodDto(
  RunPointsStarterBonusRequestSchema,
) {}

/** The counts of a completed starter-bonus run (025 EARS-43). */
export class PointsStarterBonusRunDto extends createZodDto(
  PointsStarterBonusRunSchema,
) {}

/**
 * 025 EARS-43 — `POST /v1/admin/points/starter-bonus` (025-design §J).
 * `platform_admin` only behind the 011 admin session, role fast-path; the
 * write revalidates live (#1304 default-deny for a new admin mutation). 422
 * `points-starter-bonus-no-rule` when no active rule triggers on
 * `person.starter-bonus-eligible`, 422 `points-rule-parameters-invalid` for a
 * `registeredBefore` later than now, 400 for a missing or empty reason; 200
 * with the run id and its counts otherwise. Publishing a rule never starts a
 * run (EARS-42).
 */
@Controller({ path: "admin/points/starter-bonus", version: "1" })
@UseFilters(PointsProblemFilter)
export class PointsStarterBonusAdminController {
  // Explicit @Inject tokens — the API boots under `tsx`, which emits no
  // `design:paramtypes`.
  constructor(
    @Inject(PointsStarterBonusService)
    private readonly starterBonus: PointsStarterBonusService,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOkResponse({ type: PointsStarterBonusRunDto })
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    // A `platform_admin` points operation — its trail is the run's two
    // explicit `audit_ledger` records (EARS-43), no AuthAuditLog emission.
    audit: "low-stakes",
    revalidate: "live",
    tests: ["EARS-43"],
  })
  async run(
    @Body() dto: RunPointsStarterBonusRequestDto,
    @Req() req: FastifyRequest,
  ): Promise<PointsStarterBonusRun> {
    return this.starterBonus.run(
      dto,
      (req as { user?: { sub?: string } }).user?.sub ?? null,
    );
  }
}

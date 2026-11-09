import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Param,
  Put,
  Req,
  UseFilters,
} from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { createZodDto } from "nestjs-zod";
import {
  type PointsPrice,
  PointsPriceSchema,
  PutPointsPriceRequestSchema,
} from "@ds/schemas";
import { Authz } from "../authz/index.js";
import { PointsProblemFilter } from "./points.problem-filter.js";
import { PointsPricesService } from "./points-prices.service.js";

/** Body of a price-list write (025 EARS-26). */
export class PutPointsPriceRequestDto extends createZodDto(
  PutPointsPriceRequestSchema,
) {}

/** A stored price-list row (025 EARS-26, EARS-30). */
export class PointsPriceDto extends createZodDto(PointsPriceSchema) {}

/**
 * 025 EARS-26 — `PUT /v1/admin/points/prices/:itemRef` (025-design §8,
 * production amendment A, F, I). `platform_admin` only behind the 011 admin
 * session, role fast-path; the write revalidates live (#1304 default-deny
 * for a new admin mutation). The 0061 row-audit trigger attributes the
 * row's `audit_ledger` entry to the acting admin through the request audit
 * context. 422 `points-gating-invalid` for a non-open lesson, module or
 * НМО-accredited event, or an event that does not exist; 200 with the
 * stored row otherwise. Existing holds keep their price.
 */
@Controller({ path: "admin/points/prices", version: "1" })
@UseFilters(PointsProblemFilter)
export class PointsPricesAdminController {
  // Explicit @Inject tokens — the API boots under `tsx`, which emits no
  // `design:paramtypes`.
  constructor(
    @Inject(PointsPricesService) private readonly prices: PointsPricesService,
  ) {}

  @Put(":itemRef")
  @HttpCode(200)
  @ApiOkResponse({ type: PointsPriceDto })
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    // A `platform_admin` authoring write — its trail is the 010 row audit of
    // `points_prices`, no AuthAuditLog emission.
    audit: "low-stakes",
    revalidate: "live",
    tests: ["EARS-26"],
  })
  async put(
    @Param("itemRef") itemRef: string,
    @Body() dto: PutPointsPriceRequestDto,
    @Req() req: FastifyRequest,
  ): Promise<PointsPrice> {
    return this.prices.put(
      itemRef,
      dto,
      (req as { user?: { sub?: string } }).user?.sub ?? null,
    );
  }
}

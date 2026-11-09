import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseFilters,
} from "@nestjs/common";
import { ApiCreatedResponse } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { createZodDto } from "nestjs-zod";
import {
  type PublishedPointsRuleVersion,
  PublishedPointsRuleVersionSchema,
  PublishPointsRuleVersionRequestSchema,
} from "@ds/schemas";
import { Authz } from "../authz/index.js";
import { PointsProblemFilter } from "./points.problem-filter.js";
import {
  type PublishedRuleVersion,
  RuleBookService,
} from "./rule-book.service.js";

/** Body of a rule-version publish (025 amended EARS-25). */
export class PublishPointsRuleVersionRequestDto extends createZodDto(
  PublishPointsRuleVersionRequestSchema,
) {}

/** A stored rule version with any stacking warning (025 amended EARS-25, EARS-38). */
export class PublishedPointsRuleVersionDto extends createZodDto(
  PublishedPointsRuleVersionSchema,
) {}

/**
 * 025 amended EARS-25 — `POST /v1/admin/points/rules/:ruleId/versions`
 * (025-design §8, production amendment B, I). `platform_admin` only behind
 * the 011 admin session, role fast-path; the write revalidates live (#1304
 * default-deny for a new admin mutation). The 0058 row-audit trigger
 * attributes the version's `audit_ledger` row to the acting admin through the
 * request audit context. Any admin slug or existing id is accepted; 422
 * `points-rule-parameters-invalid` (field paths relative to the body),
 * `points-rule-effective-from-past` or `points-rule-retired`; 201 with the
 * stored version and any stacking warning (EARS-38) otherwise. A version
 * applies to facts recorded afterwards only (EARS-42).
 */
@Controller({ path: "admin/points/rules", version: "1" })
@UseFilters(PointsProblemFilter)
export class PointsRulesAdminController {
  // Explicit @Inject tokens — the API boots under `tsx`, which emits no
  // `design:paramtypes`.
  constructor(
    @Inject(RuleBookService) private readonly rules: RuleBookService,
  ) {}

  @Post(":ruleId/versions")
  @HttpCode(201)
  @ApiCreatedResponse({ type: PublishedPointsRuleVersionDto })
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    // A `platform_admin` authoring write — its trail is the 010 row audit of
    // `points_rule_versions`, no AuthAuditLog emission.
    audit: "low-stakes",
    revalidate: "live",
    tests: ["EARS-25"],
  })
  async publish(
    @Param("ruleId") ruleId: string,
    @Body() dto: PublishPointsRuleVersionRequestDto,
    @Req() req: FastifyRequest,
  ): Promise<PublishedPointsRuleVersion> {
    const published = await this.rules.publish({
      ruleId,
      parameters: dto.parameters,
      effectiveFrom: dto.effectiveFrom
        ? new Date(dto.effectiveFrom)
        : undefined,
      actorSub: (req as { user?: { sub?: string } }).user?.sub ?? null,
    });
    return toPublished(published);
  }
}

function toPublished({
  row,
  warnings,
}: PublishedRuleVersion): PublishedPointsRuleVersion {
  return {
    ruleId: row.ruleId,
    version: row.version,
    kind: row.kind as PublishedPointsRuleVersion["kind"],
    parameters: row.parameters as Record<string, unknown>,
    effectiveFrom: row.effectiveFrom.toISOString(),
    publishedBy: row.publishedBy,
    createdAt: row.createdAt.toISOString(),
    warnings,
  };
}

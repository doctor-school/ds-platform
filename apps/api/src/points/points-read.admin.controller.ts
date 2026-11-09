import {
  Controller,
  Get,
  Header,
  Inject,
  Req,
  UseFilters,
} from "@nestjs/common";
import { ApiOkResponse, ApiQuery } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { createZodDto } from "nestjs-zod";
import {
  POINTS_FACT_JOURNAL_LIMIT,
  type PointsFactJournalPage,
  PointsFactJournalPageSchema,
  PointsFactJournalQuerySchema,
  type PointsFactTypeCatalog,
  PointsFactTypeCatalogSchema,
  type PointsRuleBook,
  PointsRuleBookSchema,
} from "@ds/schemas";
import { Authz } from "../authz/index.js";
import { PointsAdminReadService } from "./points-admin-read.service.js";
import { decodeFactJournalCursor } from "./points-history-cursor.js";
import { PointsLedgerError } from "./points.errors.js";
import { PointsProblemFilter } from "./points.problem-filter.js";

/** The `FactTypeCatalog` read model (025 EARS-45). */
export class PointsFactTypeCatalogDto extends createZodDto(
  PointsFactTypeCatalogSchema,
) {}

/** The `RuleBook` read model (025 EARS-45). */
export class PointsRuleBookDto extends createZodDto(PointsRuleBookSchema) {}

/** One page of the `FactJournalEntry` read model (025 EARS-45). */
export class PointsFactJournalPageDto extends createZodDto(
  PointsFactJournalPageSchema,
) {}

/**
 * 025 EARS-45 — the admin read API (025-design §8): the fact-type catalog,
 * the rule book with every version, and one person's fact journal with its
 * evaluation traces. `platform_admin` only behind the 011 admin session, role
 * fast-path; any other admin-session principal is 403, no admin session 401.
 * Reads change nothing (`revalidate: none`) and write no audit row — the same
 * as the platform's other admin reads of person data (the 044 participant
 * card); the journal carries refs and catalog attributes only, never
 * attribution (EARS-40). Per-request data ⇒ `Cache-Control: no-store`.
 */
@Controller({ path: "admin/points", version: "1" })
@UseFilters(PointsProblemFilter)
export class PointsReadAdminController {
  // Explicit @Inject tokens — the API boots under `tsx`, which emits no
  // `design:paramtypes`.
  constructor(
    @Inject(PointsAdminReadService)
    private readonly reads: PointsAdminReadService,
  ) {}

  @Get("fact-types")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: PointsFactTypeCatalogDto })
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "low-stakes",
    revalidate: "none",
    tests: ["EARS-45"],
  })
  factTypes(): PointsFactTypeCatalog {
    return this.reads.factTypeCatalog();
  }

  @Get("rules")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: PointsRuleBookDto })
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "low-stakes",
    revalidate: "none",
    tests: ["EARS-45"],
  })
  rules(): Promise<PointsRuleBook> {
    return this.reads.ruleBook();
  }

  /**
   * `GET /v1/admin/points/facts?personId=&cursor=&limit=` — newest first by
   * (`receivedAt`, `eventId`). `limit` defaults to 50, bounded 1…100
   * (`POINTS_FACT_JOURNAL_LIMIT`); a missing or non-uuid `personId`, an
   * out-of-range `limit` or a cursor this route did not issue → 400
   * `points-facts-query-invalid`. An unknown person is an empty page.
   */
  @Get("facts")
  @Header("Cache-Control", "no-store")
  @ApiQuery({ name: "personId", required: true, type: String, format: "uuid" })
  @ApiQuery({ name: "cursor", required: false, type: String })
  @ApiQuery({
    name: "limit",
    required: false,
    type: Number,
    description: `Page size, ${POINTS_FACT_JOURNAL_LIMIT.min}–${POINTS_FACT_JOURNAL_LIMIT.max} (default ${POINTS_FACT_JOURNAL_LIMIT.default}).`,
  })
  @ApiOkResponse({ type: PointsFactJournalPageDto })
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "low-stakes",
    revalidate: "none",
    tests: ["EARS-45"],
  })
  async facts(@Req() req: FastifyRequest): Promise<PointsFactJournalPage> {
    const query = PointsFactJournalQuerySchema.safeParse(req.query ?? {});
    if (!query.success) {
      throw new PointsLedgerError(
        "POINTS_FACTS_QUERY_INVALID",
        "invalid journal query",
        query.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      );
    }
    const { personId, cursor, limit } = query.data;
    const after = cursor === undefined ? null : decodeFactJournalCursor(cursor);
    if (cursor !== undefined && after === null) {
      throw new PointsLedgerError(
        "POINTS_FACTS_QUERY_INVALID",
        "invalid journal query",
        [{ path: "cursor", message: "not a cursor this route issued" }],
      );
    }
    return this.reads.factJournal(personId, { limit, after });
  }
}

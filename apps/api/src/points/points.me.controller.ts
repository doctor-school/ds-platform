import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Param,
  Req,
  UnauthorizedException,
  UseFilters,
} from "@nestjs/common";
import { ApiOkResponse, ApiQuery } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { createZodDto } from "nestjs-zod";
import { type DrizzleHandle, users } from "@ds/db";
import {
  type PointsAccount,
  PointsAccountSchema,
  type PointsGatingDecision,
  PointsGatingDecisionSchema,
  POINTS_POSTING_HISTORY_LIMIT,
  type PointsPostingHistory,
  PointsPostingHistoryQuerySchema,
  PointsPostingHistorySchema,
} from "@ds/schemas";
import { and, eq, isNull } from "drizzle-orm";
import { Authz } from "../authz/index.js";
import type { Role } from "../authz/authz.types.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { decodePostingCursor } from "./points-history-cursor.js";
import { PointsLedgerService } from "./points-ledger.service.js";
import { PointsLedgerError } from "./points.errors.js";
import { PointsProblemFilter } from "./points.problem-filter.js";
import { PointsPricesService } from "./points-prices.service.js";

/** The `PointsAccount` read model (025 EARS-2, EARS-30). */
export class PointsAccountDto extends createZodDto(PointsAccountSchema) {}

/** The `PostingHistory` read model (025 EARS-46, EARS-30). */
export class PointsPostingHistoryDto extends createZodDto(
  PointsPostingHistorySchema,
) {}

/** The `GatingDecision` read model (025 EARS-13, EARS-30). */
export class PointsGatingDecisionDto extends createZodDto(
  PointsGatingDecisionSchema,
) {}

/** Same account audience as the sibling `/v1/me/*` reads (003, #2456). */
const ACCOUNT_ROLES: Role[] = ["doctor_guest", "platform_admin"];

/**
 * 025 EARS-2 (#3813) — `GET /v1/me/points`: the CALLER's own `PointsAccount`,
 * a fold over postings (025-design §1). The person is always the session
 * subject's `users.id`; the route takes no person identifier, and a request
 * that names another person (`?personId=`) is refused with 403, never served
 * the caller's or the named account. `personId` is read off the raw query
 * rather than declared with `@Query`, so the published contract (OpenAPI
 * snapshot / SDK) carries no person parameter at all. Unauthenticated → 401 from the global
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
    @Inject(PointsPricesService) private readonly prices: PointsPricesService,
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
  async read(@Req() req: FastifyRequest): Promise<PointsAccount> {
    return this.ledger.readPersonAccount(await this.callerPersonId(req));
  }

  /**
   * 025 EARS-46 (#3842) — `GET /v1/me/points/postings?cursor=&limit=`: the
   * CALLER's own `PostingHistory`, newest first, one keyset page. Same person
   * resolution and refusals as the balance read (no person parameter; a
   * foreign `?personId=` → 403). `limit` defaults to 50 and is bounded 1…100
   * (`POINTS_POSTING_HISTORY_LIMIT`); an out-of-range `limit` or a cursor
   * this route did not issue → 400 `points-history-query-invalid`.
   */
  @Get("postings")
  @Header("Cache-Control", "no-store")
  @UseFilters(PointsProblemFilter)
  @ApiQuery({ name: "cursor", required: false, type: String })
  @ApiQuery({
    name: "limit",
    required: false,
    type: Number,
    description: `Page size, ${POINTS_POSTING_HISTORY_LIMIT.min}–${POINTS_POSTING_HISTORY_LIMIT.max} (default ${POINTS_POSTING_HISTORY_LIMIT.default}).`,
  })
  @ApiOkResponse({ type: PointsPostingHistoryDto })
  @Authz({
    access: "authenticated",
    roles: ACCOUNT_ROLES,
    check: "fast-path",
    audit: "none",
    tests: ["EARS-46"],
  })
  async postings(@Req() req: FastifyRequest): Promise<PointsPostingHistory> {
    const personId = await this.callerPersonId(req);
    const query = PointsPostingHistoryQuerySchema.safeParse(req.query ?? {});
    if (!query.success) {
      throw new PointsLedgerError(
        "POINTS_HISTORY_QUERY_INVALID",
        "invalid page query",
        query.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      );
    }
    const { cursor, limit } = query.data;
    const after = cursor === undefined ? null : decodePostingCursor(cursor);
    if (cursor !== undefined && after === null) {
      throw new PointsLedgerError(
        "POINTS_HISTORY_QUERY_INVALID",
        "invalid page query",
        [{ path: "cursor", message: "not a cursor this route issued" }],
      );
    }
    return this.ledger.readPersonPostings(personId, { limit, after });
  }

  /**
   * 025 EARS-13 (#3810) — `GET /v1/me/points/gating/:itemRef`: the CALLER's
   * `GatingDecision` on an item of any kind — `quote` (EARS-41) of a draft
   * sign-up, so it equals what the sign-up's `record` would do and writes
   * nothing. Same person resolution and refusals as the balance read. A
   * refusal the decision cannot state answers its problem (422
   * `points-phone-unverified` / `points-reserve-limit`).
   */
  @Get("gating/:itemRef")
  @Header("Cache-Control", "no-store")
  @UseFilters(PointsProblemFilter)
  @ApiOkResponse({ type: PointsGatingDecisionDto })
  @Authz({
    access: "authenticated",
    roles: ACCOUNT_ROLES,
    check: "fast-path",
    audit: "none",
    tests: ["EARS-13"],
  })
  async gating(
    @Param("itemRef") itemRef: string,
    @Req() req: FastifyRequest,
  ): Promise<PointsGatingDecision> {
    return this.prices.gating(await this.callerPersonId(req), itemRef);
  }

  /**
   * The session subject's live `users.id` (401 otherwise); a request naming
   * any other person (`?personId=`) is refused with 403.
   */
  private async callerPersonId(req: FastifyRequest): Promise<string> {
    const sub = (req as { user?: { sub?: string } }).user?.sub;
    if (!sub) throw new UnauthorizedException("authentication required");
    const [person] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.zitadelSub, sub), isNull(users.deactivatedAt)));
    if (!person) throw new UnauthorizedException("authentication required");
    // Repeated `?personId=` arrives as an array, which never equals the id.
    const requested = (req.query as Record<string, unknown> | undefined)
      ?.personId;
    if (requested !== undefined && requested !== person.id) {
      throw new ForbiddenException("another person's points account");
    }
    return person.id;
  }
}

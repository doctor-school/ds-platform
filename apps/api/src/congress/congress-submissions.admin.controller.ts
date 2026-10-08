import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ApiBody, ApiOkResponse, ApiQuery } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import {
  CONGRESS_SUBMISSION_KINDS,
  CONGRESS_SUBMISSION_REGISTRY_PAGE_SIZE_MAX,
  CONGRESS_SUBMISSION_REGISTRY_SEARCH_MAX,
  CONGRESS_SUBMISSION_REGISTRY_SORTS,
  CONGRESS_SUBMISSION_STATUSES,
  type CongressSubmissionCard,
  CongressSubmissionCardSchema,
  type CongressSubmissionRegistry,
  CongressSubmissionRegistryQuerySchema,
  CongressSubmissionRegistrySchema,
  CongressRevisionDeadlineRequestSchema,
  CongressSubmissionStatusChangeRequestSchema,
} from "@ds/schemas";
import type { AdminSessionPrincipal } from "../auth/admin-session/admin-session.service.js";
import { Authz, EventGrantPolicy } from "../authz/index.js";
import { CongressSubmissionsAdminService } from "./congress-submissions.admin.service.js";

/** Paged response of the committee registry (046 EARS-27). */
export class CongressSubmissionRegistryDto extends createZodDto(
  CongressSubmissionRegistrySchema,
) {}

/** The submission card (046 EARS-28). */
export class CongressSubmissionCardDto extends createZodDto(
  CongressSubmissionCardSchema,
) {}

/** Body of the committee status change (046 EARS-28). */
export class CongressSubmissionStatusChangeRequestDto extends createZodDto(
  CongressSubmissionStatusChangeRequestSchema,
) {}

/** Body of the revision-deadline extension (046 EARS-35). */
export class CongressRevisionDeadlineRequestDto extends createZodDto(
  CongressRevisionDeadlineRequestSchema,
) {}

const COMMITTEE = "congress-program-committee" as const;

/**
 * 046 EARS-26…EARS-29, EARS-34, EARS-35 (#2437) — the programme committee's
 * routes over one event's congress submissions,
 * `/v1/admin/events/:idOrSlug/congress-submissions*` (046-design
 * «Authorization boundary»).
 *
 * Its own controller so that the reach of `congress-program-committee` is a
 * file, not a grep: the registry, the card and the status change are every
 * route the role names (EARS-26). Each is a `check: "policy"` row without
 * `objectAttrs` whose handler runs {@link EventGrantPolicy.assertEventAccess}
 * for the committee role FIRST — before the query is parsed or the event
 * resolved — so a member reaches only the events its `event_role_grants` rows
 * bind it to and learns nothing about any other from a 400 or a 404; the
 * platform administrator is not limited by a binding.
 *
 * The extension (EARS-35) is the platform administrator's alone: a
 * `fast-path` `platform_admin` row. Both writes revalidate live (#1304; for the
 * committee, ADR-0001 A3) and run in the request audit context.
 */
@Controller({ path: "admin/events", version: "1" })
export class CongressSubmissionsAdminController {
  // Explicit @Inject tokens — the API boots under `tsx`, which emits no
  // `design:paramtypes`.
  constructor(
    @Inject(CongressSubmissionsAdminService)
    private readonly submissions: CongressSubmissionsAdminService,
    @Inject(EventGrantPolicy) private readonly grants: EventGrantPolicy,
  ) {}

  /** EARS-27 — one page of the event's registry; drafts are never listed. */
  @Get(":idOrSlug/congress-submissions")
  @ApiQuery({
    name: "q",
    required: false,
    type: String,
    maxLength: CONGRESS_SUBMISSION_REGISTRY_SEARCH_MAX,
  })
  @ApiQuery({
    name: "submitter",
    required: false,
    type: String,
    maxLength: CONGRESS_SUBMISSION_REGISTRY_SEARCH_MAX,
  })
  @ApiQuery({ name: "kind", required: false, enum: CONGRESS_SUBMISSION_KINDS })
  @ApiQuery({
    name: "status",
    required: false,
    enum: CONGRESS_SUBMISSION_STATUSES.filter((s) => s !== "draft"),
  })
  @ApiQuery({ name: "sentFrom", required: false, type: String })
  @ApiQuery({ name: "sentTo", required: false, type: String })
  @ApiQuery({
    name: "sort",
    required: false,
    enum: CONGRESS_SUBMISSION_REGISTRY_SORTS,
  })
  @ApiQuery({ name: "order", required: false, enum: ["asc", "desc"] })
  @ApiQuery({ name: "page", required: false, type: Number, minimum: 1 })
  @ApiQuery({
    name: "pageSize",
    required: false,
    type: Number,
    minimum: 1,
    maximum: CONGRESS_SUBMISSION_REGISTRY_PAGE_SIZE_MAX,
  })
  @ApiOkResponse({ type: CongressSubmissionRegistryDto })
  // A read that writes no domain state owes no terminal ledger row.
  @Authz({
    access: "authenticated",
    roles: ["platform_admin", COMMITTEE],
    check: "policy",
    audit: "low-stakes",
    revalidate: "none",
    tests: ["EARS-26", "EARS-27"],
  })
  async registry(
    @Req() req: FastifyRequest,
    @Param("idOrSlug") idOrSlug: string,
    @Query() rawQuery: Record<string, string>,
  ): Promise<CongressSubmissionRegistry> {
    const eventKey = await this.bound(req, idOrSlug);
    const parsed = CongressSubmissionRegistryQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "invalid registry query",
        issues: parsed.error.issues,
      });
    }
    return this.submissions.registry(eventKey, parsed.data);
  }

  /** EARS-28 — the card; 404 for a draft, an unknown id or another event's. */
  @Get(":idOrSlug/congress-submissions/:submissionId")
  @ApiOkResponse({ type: CongressSubmissionCardDto })
  @Authz({
    access: "authenticated",
    roles: ["platform_admin", COMMITTEE],
    check: "policy",
    audit: "low-stakes",
    revalidate: "none",
    tests: ["EARS-26", "EARS-28"],
  })
  async card(
    @Req() req: FastifyRequest,
    @Param("idOrSlug") idOrSlug: string,
    @Param("submissionId") submissionId: string,
  ): Promise<CongressSubmissionCard> {
    const eventKey = await this.bound(req, idOrSlug);
    return this.submissions.card(eventKey, submissionId);
  }

  /**
   * EARS-28, EARS-29, EARS-34 — the committee's status change. 200 with the
   * card; 400 for a missing or over-long comment on `rejected` /
   * `needs_revision`; 409 `status-conflict` when the status is not the one the
   * member saw, `transition-not-allowed` off the status machine (any change on
   * `withdrawn`).
   */
  @Post(":idOrSlug/congress-submissions/:submissionId/status")
  @HttpCode(200)
  @ApiBody({ type: CongressSubmissionStatusChangeRequestDto })
  @ApiOkResponse({ type: CongressSubmissionCardDto })
  @Authz({
    access: "authenticated",
    roles: ["platform_admin", COMMITTEE],
    check: "policy",
    // The domain trail is the 010 capture trigger's ledger rows of the
    // submission (its status history), not an authz-tier emission.
    audit: "low-stakes",
    // #1304 default-deny + ADR-0001 A3: the committee grant the
    // member acts under is re-established against the live IdP.
    revalidate: "live",
    tests: ["EARS-28", "EARS-29", "EARS-34"],
  })
  async changeStatus(
    @Req() req: FastifyRequest,
    @Param("idOrSlug") idOrSlug: string,
    @Param("submissionId") submissionId: string,
    @Body() body: unknown,
  ): Promise<CongressSubmissionCard> {
    const eventKey = await this.bound(req, idOrSlug);
    const parsed = CongressSubmissionStatusChangeRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "invalid status change",
        issues: parsed.error.issues,
      });
    }
    return this.submissions.changeStatus(eventKey, submissionId, parsed.data);
  }

  /**
   * EARS-35 — the platform administrator's extension of a `needs_revision`
   * submission's deadline. 200 with the card; 409 `not-needs-revision`; 422
   * `revision-day-not-later` / `revision-day-in-past`.
   */
  @Post(":idOrSlug/congress-submissions/:submissionId/revision-deadline")
  @HttpCode(200)
  @ApiBody({ type: CongressRevisionDeadlineRequestDto })
  @ApiOkResponse({ type: CongressSubmissionCardDto })
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "low-stakes",
    revalidate: "live",
    tests: ["EARS-35"],
  })
  async extendRevisionDeadline(
    @Param("idOrSlug") idOrSlug: string,
    @Param("submissionId") submissionId: string,
    @Body() body: unknown,
  ): Promise<CongressSubmissionCard> {
    const parsed = CongressRevisionDeadlineRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "invalid revision deadline",
        issues: parsed.error.issues,
      });
    }
    return this.submissions.extendRevisionDeadline(
      idOrSlug,
      submissionId,
      parsed.data,
    );
  }

  /** EARS-26 — the committee binding step; the administrator passes unchanged. */
  private bound(req: FastifyRequest, idOrSlug: string): Promise<string> {
    return this.grants.assertEventAccess(
      (req as { user?: AdminSessionPrincipal }).user,
      idOrSlug,
      COMMITTEE,
    );
  }
}

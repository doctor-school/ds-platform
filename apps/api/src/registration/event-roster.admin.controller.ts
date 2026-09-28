import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ApiOkResponse, ApiQuery } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import {
  type CongressRosterList,
  CongressRosterListSchema,
  CongressRosterQuerySchema,
  CONGRESS_ROSTER_PAGE_SIZE_MAX,
  CONGRESS_ROSTER_SEARCH_MAX,
} from "@ds/schemas";
import type { AdminSessionPrincipal } from "../auth/admin-session/admin-session.service.js";
import { Authz, EventGrantPolicy } from "../authz/index.js";
import {
  RegistrationEventNotFoundError,
  RegistrationService,
} from "./registration.service.js";

/** Paged response of `GET /v1/admin/events/:idOrSlug/roster` (044 EARS-18). */
export class CongressRosterListDto extends createZodDto(
  CongressRosterListSchema,
) {}

/**
 * 044 EARS-18 — the HTTP route over the `eventRoster()` read model.
 *
 * It is its OWN controller rather than a handler on `EventsAdminController` for
 * one authorization reason: that controller is the 007 `platform_admin` surface,
 * every route on it is a full-administration route, and adding the one route a
 * registrar may reach would put a second, weaker role inside a class of routes
 * whose whole shape says «administrator». The reach of `event-registrar` is meant
 * to be readable as a list (044-design §«Authorization boundary»), and a
 * dedicated controller makes that list a file rather than a grep.
 *
 * It lives in `registration/` rather than `events/` because the roster is a
 * registration read model — 005 owns `eventRoster()` and its repository query,
 * and a controller elsewhere would have to reach across a module to call it.
 *
 * `revalidate` is deliberately absent (i.e. `none`): live IdP re-verification is
 * the posture of admin MUTATIONS (#1304), and this is a read that changes
 * nothing. EARS-24 fixes that the roster exposes no mutation at all, so there is
 * no sibling write on this controller to be inconsistent with.
 *
 * 044 EARS-38 (#2384): the role is necessary, not sufficient. Every route here
 * is a `check: "policy"` row without `objectAttrs`, and its handler runs
 * {@link EventGrantPolicy.assertEventAccess} — the registrar reaches only the
 * event its `event_role_grants` row binds it to; the platform administrator is
 * not limited. A future desk route on this family (card, attendance, manual
 * registration) takes the same step; the denial-set suite's EARS-38.6 sweep
 * fails any registrar-reachable route classified `fast-path`.
 */
@Controller({ path: "admin/events", version: "1" })
export class EventRosterAdminController {
  constructor(
    private readonly registrations: RegistrationService,
    private readonly grants: EventGrantPolicy,
  ) {}

  /**
   * 044 EARS-18 — one page of the roster of `:idOrSlug`, for the registrar and
   * the platform administrator alike.
   *
   * An unknown event is a 404 (the same mapping the 007 admin reads make for a
   * missing event), never an empty page: «этого события нет» and «на это событие
   * никто не записан» are different answers and the desk must not confuse them.
   * That 404 is the administrator's answer: for a registrar an unknown event is
   * «not the bound event» and is refused by the binding step first (EARS-38).
   */
  @Get(":idOrSlug/roster")
  @ApiQuery({
    name: "q",
    required: false,
    type: String,
    maxLength: CONGRESS_ROSTER_SEARCH_MAX,
  })
  @ApiQuery({ name: "page", required: false, type: Number, minimum: 1 })
  @ApiQuery({
    name: "pageSize",
    required: false,
    type: Number,
    minimum: 1,
    maximum: CONGRESS_ROSTER_PAGE_SIZE_MAX,
  })
  @ApiOkResponse({ type: CongressRosterListDto })
  // `audit: low-stakes` — a read that writes no domain state owes no terminal
  // ledger row (endpoint-authz design §3), exactly like the 007 admin reads.
  @Authz({
    access: "authenticated",
    roles: ["platform_admin", "event-registrar"],
    check: "policy",
    audit: "low-stakes",
    revalidate: "none",
    tests: ["EARS-18", "EARS-38"],
  })
  async roster(
    @Req() req: FastifyRequest,
    @Param("idOrSlug") idOrSlug: string,
    @Query() rawQuery: Record<string, string>,
  ): Promise<CongressRosterList> {
    // EARS-38 — the event-binding step runs BEFORE the query is parsed or the
    // event resolved, so a refused registrar learns nothing from a 400 or 404.
    const eventKey = await this.grants.assertEventAccess(
      (req as { user?: AdminSessionPrincipal }).user,
      idOrSlug,
    );
    const parsed = CongressRosterQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "invalid roster list query",
        issues: parsed.error.issues,
      });
    }
    try {
      return await this.registrations.eventRosterPage(eventKey, parsed.data);
    } catch (err) {
      if (err instanceof RegistrationEventNotFoundError) {
        throw new NotFoundException("event not found");
      }
      throw err;
    }
  }
}

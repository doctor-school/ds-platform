import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ApiOkResponse } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import {
  type CongressDeskRegistrationResponse,
  CongressDeskRegistrationRequestSchema,
  CongressDeskRegistrationResponseSchema,
} from "@ds/schemas";
import type { AdminSessionPrincipal } from "../auth/admin-session/admin-session.service.js";
import { Authz, EventGrantPolicy } from "../authz/index.js";
import { CongressSignUpService } from "../congress/congress-signup.service.js";

/** Body of `POST /v1/admin/events/:idOrSlug/registrations` (044 EARS-35). */
export class CongressDeskRegistrationRequestDto extends createZodDto(
  CongressDeskRegistrationRequestSchema,
) {}

/** Response of `POST /v1/admin/events/:idOrSlug/registrations` (044 EARS-35). */
export class CongressDeskRegistrationResponseDto extends createZodDto(
  CongressDeskRegistrationResponseSchema,
) {}

/**
 * 044 EARS-35 — the registrar's manual («стол») registration of a walk-in
 * participant, on the desk-route family the roster opened
 * (`event-roster.admin.controller.ts`).
 *
 * The handler is a thin door onto the ONE congress intake use-case
 * ({@link CongressSignUpService.signUp} with `origin: "desk"`), so the account,
 * registration, consent and confirmation-email rules are the site form's by
 * construction, not by a copy kept in sync.
 *
 * What the public intake route carries and this one deliberately does not:
 * `@Public`, `@BotProtected`, `@RateLimited` and `@TimingEqualized`. All four
 * defend an UNAUTHENTICATED door against bots, floods and the «is this email
 * known?» oracle; this route sits behind an MFA admin session bound to one
 * event, and the registrar may see the whole roster of that event anyway, so
 * there is no oracle left to equalise (EARS-35). The registration window is
 * the public form's; the use-case does not ask it for the desk.
 *
 * `check: "policy"` + {@link EventGrantPolicy.assertEventAccess} for the same
 * reason as the roster (EARS-38): the role admits the principal, the binding
 * admits the event. The 010 interceptor attributes every row this call writes
 * to the acting registrar with source `admin-ui`.
 */
@Controller({ path: "admin/events", version: "1" })
export class DeskRegistrationAdminController {
  // Explicit @Inject tokens — the API boots under `tsx`, which emits no
  // `design:paramtypes`.
  constructor(
    @Inject(CongressSignUpService)
    private readonly intake: CongressSignUpService,
    @Inject(EventGrantPolicy) private readonly grants: EventGrantPolicy,
  ) {}

  /**
   * `POST /v1/admin/events/:idOrSlug/registrations` — enter one walk-in.
   *
   * 200 in both outcomes: `accepted` names the new registration, `existing`
   * names the one the participant already had for this event (EARS-8) so the
   * registrar can open its card. Neither says whether the ACCOUNT existed.
   * A body without the paper-consent tick is refused by the Zod pipe (400)
   * before the handler — and therefore before any write or email.
   */
  @Post(":idOrSlug/registrations")
  @HttpCode(200)
  @ApiOkResponse({ type: CongressDeskRegistrationResponseDto })
  @Authz({
    access: "authenticated",
    roles: ["platform_admin", "event-registrar"],
    check: "policy",
    audit: "high-stakes",
    // #1304: a WRITE that creates accounts and registrations re-checks the
    // principal against the IdP on every call. The roster's `revalidate:
    // "none"` is a read-only carve-out and does not extend to this route.
    revalidate: "live",
    tests: ["EARS-35", "EARS-38"],
  })
  async register(
    @Req() req: FastifyRequest,
    @Param("idOrSlug") idOrSlug: string,
    @Body() dto: CongressDeskRegistrationRequestDto,
  ): Promise<CongressDeskRegistrationResponse> {
    // EARS-38 — the event-binding step runs before the use-case, so a refused
    // registrar causes no account lookup and no write.
    const eventKey = await this.grants.assertEventAccess(
      (req as { user?: AdminSessionPrincipal }).user,
      idOrSlug,
    );
    const outcome = await this.intake.signUp(dto, {
      origin: "desk",
      eventKey,
      consentOrigin: "paper",
    });
    return {
      status: outcome.created ? "accepted" : "existing",
      registrationId: outcome.registrationId,
    };
  }
}

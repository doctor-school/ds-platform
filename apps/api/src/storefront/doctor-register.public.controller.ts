import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Ip,
  Post,
  Res,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { DoctorRegisterResponse, VerifyResponse } from "@ds/schemas";

import { Authz, Public } from "../authz/index.js";
import { BotProtected } from "../bot-protection/index.js";
import { RateLimited, RateLimitService } from "../auth/rate-limit/index.js";
import { TimingEqualized } from "../auth/timing/index.js";
import { computeFingerprint } from "../auth/session/session.cookie.js";
import {
  DoctorRegisterRequestDto,
  DoctorVerifyRequestDto,
} from "./doctor-register.dto.js";
import { DoctorRegisterService } from "./doctor-register.service.js";

/**
 * 021 EARS-4 — the doctor-storefront registration command.
 *
 * `POST /v1/storefront/doctor/register`. Public (an unauthenticated entry point
 * that mints identity), carrying the SAME abuse and disclosure protections as
 * the 003 register handler it delegates to — by construction, not by
 * coincidence:
 *
 * - `@BotProtected("register")` — the 003 EARS-17 server half applies to this
 *   door unchanged; 021 defines no provider, threshold or challenge logic of its
 *   own (021 design §2). Its CLIENT half is not yet built in `apps/doctor`
 *   (EARS-19, #1558); the global guard no-ops while the provider is disabled, so
 *   the endpoint is gated the moment the provider is enabled and #1558 only has
 *   to supply the token. Marking the handler now — rather than after #1558 —
 *   is what keeps the storefront door from being the one registration surface
 *   the gate does not cover.
 * - `@RateLimited()` + `@TimingEqualized()` — 003 EARS-16 is a TIMING property as
 *   much as a body property: a faster refusal for an unknown email would be an
 *   existence oracle however identical the response body is.
 *
 * The EARS-4 refusal is raised by the service before any of that reaches the
 * IdP, so a registration missing the declaration creates no account, no mirror
 * row and no consent row.
 */
@Controller({ path: "storefront/doctor", version: "1" })
export class DoctorRegisterPublicController {
  // Explicit @Inject token — the API boots under `tsx`, which emits no
  // `design:paramtypes`.
  constructor(
    @Inject(DoctorRegisterService)
    private readonly doctorRegister: DoctorRegisterService,
    @Inject(RateLimitService)
    private readonly rateLimit: RateLimitService,
  ) {}

  /** `POST /v1/storefront/doctor/register` — the 021 `RegisterDoctor` command. */
  @Post("register")
  @Public()
  @RateLimited()
  @TimingEqualized()
  @BotProtected("register")
  // 200, not 201: the response is deliberately identical for a created and an
  // already-existing account (003 EARS-16 / 021 EARS-13), and a 201 would
  // disclose which of the two happened.
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-4"],
  })
  register(
    @Body() dto: DoctorRegisterRequestDto,
  ): Promise<DoctorRegisterResponse> {
    return this.doctorRegister.register(dto);
  }

  /**
   * `POST /v1/storefront/doctor/verify` — the doctor host's one code step
   * (003 EARS-23/41). The 003 `/verify` contract — same guards, same generic
   * 400 on every failure (EARS-16), the `__Host-` session cookie on success —
   * with this door's registration values, whose consent versions are stamped
   * exactly as {@link register} stamps them. `@TimingEqualized` as on the 003
   * route: a wrong code discloses neither existence nor state (EARS-41).
   */
  @Post("verify")
  @Public()
  @RateLimited()
  @TimingEqualized()
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-41"],
  })
  async verify(
    @Body() dto: DoctorVerifyRequestDto,
    @Headers("user-agent") userAgent: string | undefined,
    @Headers("accept-language") acceptLanguage: string | undefined,
    @Ip() ip: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<VerifyResponse> {
    const fingerprint = computeFingerprint({ userAgent, ip, acceptLanguage });
    // A wrong code throws the generic failure; a success signs the user in and,
    // like every successful login, forgives the per-user window keyed on
    // `email` (003 EARS-13, #2614).
    const { cookie, body } = await this.doctorRegister.verify(dto, fingerprint);
    this.rateLimit.reset({ ip, identifier: dto.email });
    reply.header("set-cookie", cookie);
    return body;
  }
}

import { Body, Controller, Headers, HttpCode, Post } from "@nestjs/common";
import type {
  RegisterResponse,
  VerifyResponse,
  ZitadelWebhookResponse,
} from "@ds/schemas";
import { Authz, Public } from "../authz/index.js";
import { BotProtected } from "../bot-protection/index.js";
import { AuthService } from "./auth.service.js";
import {
  RegisterRequestDto,
  VerifyRequestDto,
  ZitadelWebhookDto,
} from "./auth.dto.js";
import { WEBHOOK_SECRET_HEADER } from "./auth.tokens.js";

/**
 * F1 auth surface (#85). All three routes are `public` in the authz sense (no
 * authenticated subject — design §7.2 / spec §3): they are the unauthenticated
 * entry points that mint identity. Each carries complete `@Authz` metadata (the
 * BLOCK completeness gate) and registration is `@BotProtected` (EARS-17). The
 * webhook authenticates Zitadel out-of-band with a shared secret, verified in
 * the service.
 *
 * The single type-inferred constructor dependency mirrors ReadinessController:
 * tsx/esbuild (the endpoint-authz lint gate) mis-emits `design:paramtypes` for a
 * type-inferred parameter that precedes an `@Inject` one, so the webhook secret
 * is injected into AuthService, not here.
 */
@Controller({ path: "auth", version: "1" })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  @Public()
  @BotProtected("register")
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-1", "EARS-2", "EARS-20", "EARS-16"],
  })
  register(@Body() dto: RegisterRequestDto): Promise<RegisterResponse> {
    return this.auth.register(dto);
  }

  @Post("verify")
  @Public()
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-3", "EARS-4"],
  })
  verify(@Body() dto: VerifyRequestDto): Promise<VerifyResponse> {
    return this.auth.verify(dto);
  }

  @Post("zitadel/webhook")
  @Public()
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "low-stakes",
    tests: ["EARS-19"],
  })
  webhook(
    @Headers(WEBHOOK_SECRET_HEADER) provided: string | undefined,
    @Body() dto: ZitadelWebhookDto,
  ): Promise<ZitadelWebhookResponse> {
    return this.auth.syncFromWebhook(provided, dto);
  }
}

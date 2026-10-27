import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Ip,
  Post,
  Res,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type {
  StorefrontRedeemResponse,
  StorefrontTransactionResponse,
} from "@ds/schemas";
import { ApiExcludeController } from "@nestjs/swagger";
import { Authz } from "../authz/index.js";
import { RateLimited } from "../auth/rate-limit/index.js";
import {
  STOREFRONT_ENTRY_RATE_LIMIT_SCOPE,
  STOREFRONT_REDEEM_RATE_LIMIT_SCOPE,
} from "../auth/rate-limit/rate-limit.types.js";
import { computeFingerprint } from "../auth/session/session.cookie.js";
import {
  StorefrontRedeemRequestDto,
  StorefrontTransactionRequestDto,
} from "./storefront-oidc.dto.js";
import { StorefrontOidcService } from "./storefront-oidc.service.js";

export {
  STOREFRONT_ENTRY_RATE_LIMIT_SCOPE,
  STOREFRONT_REDEEM_RATE_LIMIT_SCOPE,
};

/**
 * 003 EARS-62 / EARS-8 (amended) / EARS-71 — `POST /v1/internal/oidc/*`, the
 * storefront servers' calls into the API (ADR-0015 §4 steps 1 and 3).
 *
 * Mounted under `INTERNAL_API_PREFIX`: every public edge and same-origin BFF
 * refuses the prefix, and `InternalApiMiddleware` answers 404 to any caller
 * without the internal credential, so no browser reaches these routes. They
 * are classified `access: internal` and are not public API surface: excluded
 * from the OpenAPI document and the generated client — the storefront servers
 * call them with a typed fetch over the `@ds/schemas` storefront-OIDC schemas.
 * The storefront server forwards the browser's `user-agent`,
 * `accept-language` and `x-forwarded-for`, so the fingerprint (checked
 * against the record's, EARS-64) and the per-IP limit see the person,
 * exactly as on the BFF rewrites.
 */
@ApiExcludeController()
@Controller({ path: "internal/oidc", version: "1" })
export class StorefrontOidcController {
  constructor(private readonly oidc: StorefrontOidcService) {}

  @Post("transaction")
  @RateLimited(STOREFRONT_ENTRY_RATE_LIMIT_SCOPE)
  @HttpCode(200)
  @Authz({
    access: "internal",
    check: "none",
    audit: "none",
    tests: ["EARS-61", "EARS-71"],
  })
  transaction(
    @Body() dto: StorefrontTransactionRequestDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StorefrontTransactionResponse> {
    reply.header("cache-control", "no-store");
    return this.oidc.createTransaction(dto);
  }

  @Post("redeem")
  @RateLimited(STOREFRONT_REDEEM_RATE_LIMIT_SCOPE)
  @HttpCode(200)
  @Authz({
    access: "internal",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-8", "EARS-62"],
  })
  async redeem(
    @Body() dto: StorefrontRedeemRequestDto,
    @Headers("user-agent") userAgent: string | undefined,
    @Headers("accept-language") acceptLanguage: string | undefined,
    @Ip() ip: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StorefrontRedeemResponse> {
    const { cookie, claims, returnPath, door, completeRegistration } =
      await this.oidc.redeem(
        dto,
        computeFingerprint({ userAgent, ip, acceptLanguage }),
      );
    reply.header("set-cookie", cookie);
    reply.header("cache-control", "no-store");
    return { ...claims, returnPath, door, completeRegistration };
  }
}

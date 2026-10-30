import { Body, Controller, Headers, HttpCode, Post, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { Authz } from "../authz/index.js";
import { RateLimited } from "../auth/rate-limit/index.js";
import { BACK_CHANNEL_LOGOUT_RATE_LIMIT_SCOPE } from "../auth/rate-limit/rate-limit.types.js";
import { StorefrontOidcService } from "./storefront-oidc.service.js";

export { BACK_CHANNEL_LOGOUT_RATE_LIMIT_SCOPE };

const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";

/**
 * 003 EARS-65, ADR-0015 §4 «One sign-out» req. 6 / 9 —
 * `POST /v1/auth/back-channel-logout`, the `back_channel_logout_uri` both
 * storefront clients register at Zitadel (provisioned in every environment).
 * Public: its only credential is the issuer's signature on the logout token,
 * verified before anything is revoked. It takes no identifier from the
 * caller; the `sid` comes from the verified token only. Not public API
 * surface (Zitadel is the one caller): excluded from the OpenAPI document.
 *
 * The request is the BCL §2.5 form post (`logout_token`, form-encoded, read
 * by the adapter's url-encoded parser); any other shape is invalid.
 * BCL §2.8: `200` when the token was valid and its sessions are revoked,
 * `400 {"error":"invalid_request"}` otherwise; both `Cache-Control: no-store`.
 */
@ApiExcludeController()
@Controller({ path: "auth", version: "1" })
export class BackChannelLogoutController {
  constructor(private readonly oidc: StorefrontOidcService) {}

  @Post("back-channel-logout")
  @RateLimited(BACK_CHANNEL_LOGOUT_RATE_LIMIT_SCOPE)
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-65"],
  })
  async backChannelLogout(
    @Body() body: unknown,
    @Headers("content-type") contentType: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ error: "invalid_request" } | undefined> {
    reply.header("cache-control", "no-store");
    const form = (contentType ?? "")
      .toLowerCase()
      .startsWith(FORM_CONTENT_TYPE);
    const token =
      form && body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)["logout_token"]
        : undefined;
    if (
      typeof token === "string" &&
      token &&
      (await this.oidc.backChannelLogout(token))
    )
      return undefined;
    reply.status(400);
    return { error: "invalid_request" };
  }
}

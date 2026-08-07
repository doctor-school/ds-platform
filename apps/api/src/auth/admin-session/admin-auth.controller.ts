import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Ip,
  Post,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { AdminLoginResponse, AdminLogoutResponse } from "@ds/schemas";
import { Authz, Public } from "../../authz/index.js";
import { RateLimited } from "../rate-limit/index.js";
import { TimingEqualized } from "../timing/index.js";
import { computeFingerprint, parseCookies } from "../session/session.cookie.js";
import { ADMIN_SESSION_COOKIE_NAME } from "./admin-session.cookie.js";
import { AdminSessionService } from "./admin-session.service.js";
import { AdminLoginRequestDto } from "./admin-auth.dto.js";

/**
 * One generic message for every admin primary-auth refusal — wrong password,
 * unknown identifier, soft-locked account, and a principal the
 * `role → mfa_required` policy does not cover all return this. The admin login
 * screen is internet-facing and ADR-0001 §7 records that the IdP has shipped
 * repeated enumeration bypasses, so our own response is the backstop: a caller
 * must not learn whether an account exists or holds `platform_admin`.
 */
const GENERIC_ADMIN_LOGIN_FAILURE = "invalid credentials";

/**
 * 011 admin auth surface (EARS-2, EARS-3) — the admin tier's own entry points,
 * mounted under the `/v1/admin/**` namespace so `AdminSessionAuthHook` owns their
 * authentication.
 *
 * **What this slice deliberately does not have.** The enrollment and challenge
 * endpoints (`/mfa/enroll/start`, `/mfa/enroll/verify`, `/mfa/verify`) land with
 * EARS-4/5/6 in #1191/#1192. Until they do, a pending authentication has nowhere
 * to go — which is the WBS sequencing of the 011 chain, stated plainly rather
 * than papered over with a stub that would have to be un-built later.
 */
@Controller({ path: "admin/auth", version: "1" })
export class AdminAuthController {
  constructor(private readonly admin: AdminSessionService) {}

  /**
   * EARS-3 — `StartAdminLogin`. Primary password authentication at the admin
   * origin. On success it issues **no session**: the `role → mfa_required` policy
   * is evaluated immediately after, and a policy role receives a short-lived
   * pending-auth reference (its own host-only `SameSite=Strict` cookie) plus the
   * required next step. Every failure is the same generic 401.
   *
   * The fingerprint is derived here — the controller is the only layer holding
   * the request — and bound into the pending record, exactly as 003's login does.
   */
  @Post("login")
  @Public()
  @RateLimited()
  @TimingEqualized()
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-3"],
  })
  async login(
    @Body() dto: AdminLoginRequestDto,
    @Headers("user-agent") userAgent: string | undefined,
    @Headers("accept-language") acceptLanguage: string | undefined,
    @Ip() ip: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdminLoginResponse> {
    const fingerprint = computeFingerprint({ userAgent, ip, acceptLanguage });
    const outcome = await this.admin.startLogin(
      dto.identifier,
      dto.password,
      fingerprint,
    );
    if (outcome.status !== "pending") {
      throw new UnauthorizedException(GENERIC_ADMIN_LOGIN_FAILURE);
    }
    // ONLY the pending cookie. No `__Host-ds_admin_session`, no token in the
    // body, and `__Host-ds_session` is neither set nor modified (EARS-1).
    reply.header("set-cookie", outcome.cookie);
    return { state: outcome.state };
  }

  /**
   * EARS-2 — `EndAdminSession`. Deletes the admin session record and clears the
   * admin cookie pair; any concurrent doctor-portal session is left untouched.
   * `platform_admin` + a live admin session is required (the hook resolves the
   * principal only from `__Host-ds_admin_session`), and — as a state-changing
   * admin endpoint — it carries the EARS-10 CSRF double-submit header.
   */
  @Post("logout")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "high-stakes",
    tests: ["EARS-2"],
  })
  async logout(
    @Headers("cookie") cookieHeader: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdminLogoutResponse> {
    const sid = parseCookies(cookieHeader)[ADMIN_SESSION_COOKIE_NAME];
    const { cookies } = await this.admin.logout(sid ?? "");
    reply.header("set-cookie", cookies);
    return { status: "logged_out" };
  }
}

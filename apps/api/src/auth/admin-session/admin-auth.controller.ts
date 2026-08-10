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
import type {
  AdminEnrollmentOffer,
  AdminLoginResponse,
  AdminLogoutResponse,
  AdminMfaEnrollVerifyResponse,
} from "@ds/schemas";
import { Authz, Public } from "../../authz/index.js";
import { RateLimited } from "../rate-limit/index.js";
import { TimingEqualized } from "../timing/index.js";
import { computeFingerprint, parseCookies } from "../session/session.cookie.js";
import {
  ADMIN_PENDING_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
} from "./admin-session.cookie.js";
import { AdminSessionService } from "./admin-session.service.js";
import {
  AdminLoginRequestDto,
  AdminMfaCodeRequestDto,
} from "./admin-auth.dto.js";

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
 * One generic message for every second-factor refusal (EARS-7). A wrong code, a
 * code from an expired window, a replayed code, a subject with no provisional
 * factor, and a stale or foreign pending reference all return exactly this, under
 * `@TimingEqualized()`. A caller must not be able to learn whether an account
 * exists, holds a factor, or is locked — so the discriminating reason lives only
 * in the ledger, never in the response.
 */
const GENERIC_ADMIN_MFA_FAILURE = "verification failed";

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
   * EARS-5 — `StartMfaEnrollment`. Registers a **provisional** TOTP factor for
   * the pending principal and returns the one-time offer: the scannable
   * provisioning URI, the same secret in transcribable form, and the labels the
   * authenticator app files it under.
   *
   * `access: pending-auth` — reachable only between primary auth and a satisfied
   * factor, and only by a principal whose next step is enrollment. The reference
   * is resolved server-side against the fingerprint this request binds, so a
   * pending cookie replayed from another device buys nothing.
   *
   * **The offer is one-shot.** A second call registers a fresh provisional factor
   * with a NEW secret and the previous one stops verifying — the operator who
   * lost the screen gets a new factor, never a second look at the old secret. The
   * secret is in this response body and nowhere else: never a log line, never an
   * audit row, never a later response.
   */
  @Post("mfa/enroll/start")
  @Public()
  @RateLimited()
  @TimingEqualized()
  @HttpCode(200)
  // `audit: low-stakes` is the honest value, not an under-classification: the
  // 011 Event Model says `StartMfaEnrollment` "emits nothing durable (the factor
  // is not yet confirmed)". `high-stakes` asserts a MANDATORY terminal row
  // (endpoint-authz design §3), so claiming it here would advertise a row the
  // spec forbids — and this is the one call that touches the shared secret, so
  // "no row" is a property to protect, not a gap to close. The lifecycle row is
  // the verify's, where possession is proven.
  @Authz({
    access: "pending-auth",
    roles: ["platform_admin"],
    check: "none",
    audit: "low-stakes",
    tests: ["EARS-4", "EARS-5"],
  })
  async startMfaEnrollment(
    @Headers("cookie") cookieHeader: string | undefined,
    @Headers("user-agent") userAgent: string | undefined,
    @Headers("accept-language") acceptLanguage: string | undefined,
    @Ip() ip: string,
  ): Promise<AdminEnrollmentOffer> {
    const ref = parseCookies(cookieHeader)[ADMIN_PENDING_COOKIE_NAME] ?? "";
    const offer = await this.admin.startEnrollment(
      ref,
      computeFingerprint({ userAgent, ip, acceptLanguage }),
    );
    if (!offer) throw new UnauthorizedException(GENERIC_ADMIN_MFA_FAILURE);
    return offer;
  }

  /**
   * EARS-5 — `VerifyMfaEnrollment`. Verifies the first code against the
   * provisional factor; a correct code registers the factor, appends
   * `auth.mfa.enrolled`, and **upgrades the pending authentication in place**
   * into the dedicated admin session (LD-1) — the operator lands in admin with no
   * second login.
   *
   * Every refusal — wrong code, expired window, replayed code, no provisional
   * factor, stale or foreign pending reference — is the same 401 with the same
   * body, under `@TimingEqualized()`, so the response discriminates nothing
   * (EARS-7). An incorrect code leaves the operator on the enrollment step with
   * the factor unconfirmed and the pending authentication intact.
   */
  @Post("mfa/enroll/verify")
  @Public()
  @RateLimited()
  @TimingEqualized()
  @HttpCode(200)
  @Authz({
    access: "pending-auth",
    roles: ["platform_admin"],
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-4", "EARS-5"],
  })
  async verifyMfaEnrollment(
    @Body() dto: AdminMfaCodeRequestDto,
    @Headers("cookie") cookieHeader: string | undefined,
    @Headers("user-agent") userAgent: string | undefined,
    @Headers("accept-language") acceptLanguage: string | undefined,
    @Ip() ip: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdminMfaEnrollVerifyResponse> {
    const ref = parseCookies(cookieHeader)[ADMIN_PENDING_COOKIE_NAME] ?? "";
    const upgraded = await this.admin.verifyEnrollment(
      ref,
      computeFingerprint({ userAgent, ip, acceptLanguage }),
      dto.code,
    );
    if (!upgraded) throw new UnauthorizedException(GENERIC_ADMIN_MFA_FAILURE);
    // The admin session pair, plus the clearing of the pending cookie the
    // upgrade consumed — a pending reference never coexists with the session it
    // became (design §8).
    reply.header("set-cookie", [
      ...upgraded.cookies,
      this.admin.clearPending(),
    ]);
    return { state: "active" };
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

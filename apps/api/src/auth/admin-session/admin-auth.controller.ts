import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Ip,
  Post,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type {
  AdminAuthStateResponse,
  AdminEnrollmentOffer,
  AdminLoginResponse,
  AdminLogoutResponse,
  AdminMfaEnrollVerifyResponse,
  AdminMfaVerifyResponse,
} from "@ds/schemas";
import { Authz, Public } from "../../authz/index.js";
import { IdpUnavailableError } from "../idp/idp.types.js";
import { RateLimited } from "../rate-limit/index.js";
import { TimingEqualized } from "../timing/index.js";
import { computeFingerprint, parseCookies } from "../session/session.cookie.js";
import {
  ADMIN_PENDING_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
} from "./admin-session.cookie.js";
import {
  AdminSessionService,
  type AdminLoginOutcome,
  type AdminMfaVerifyOutcome,
} from "./admin-session.service.js";
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
 * The IdP-fault answer, mirroring the portal's #202 mapping
 * (`auth.service.ts` → `GENERIC_UNAVAILABLE`): a genuine infra fault is an
 * honest 503 "unavailable", **never** a bare 500.
 *
 * This is a security control, not cosmetics. The IdP calls behind `startLogin`
 * — the OIDC exchange and the EARS-3 factor read — run only AFTER the password
 * matched AND `requiresMfa(roles)` passed. An unmapped throw would therefore
 * surface a 500 for exactly one input class (valid credentials on a
 * `platform_admin`) while every other outcome stays the uniform 401 — a
 * `platform_admin`-membership oracle. Both refusal and fault are mapped here, in
 * the handler, so `TimingEqualizationInterceptor` still pads them identically.
 */
const GENERIC_ADMIN_UNAVAILABLE = "the service is temporarily unavailable";

/**
 * The ADR-0001 §7 throttled answer, worded identically to the global
 * `RateLimitGuard`'s (EARS-13/16): it names no threshold, no dimension and no
 * account. This is not a second failure taxonomy sneaking past EARS-7 — it
 * reports the CALLER's own attempt rate, which the caller already knows, and it
 * is the same answer the guard gives every over-rate caller on this route.
 */
const GENERIC_ADMIN_THROTTLED = "too many requests, please try again later";

/**
 * 011 admin auth surface (EARS-2, EARS-3, EARS-5, EARS-6, EARS-7) — the admin
 * tier's own entry points, mounted under the `/v1/admin/**` namespace so
 * `AdminSessionAuthHook` owns their authentication.
 *
 * The whole arc lives here: primary auth produces a pending authentication and no
 * session; enrollment or challenge turns that pending authentication into
 * `__Host-ds_admin_session` in place (LD-1); `GET state` is the one read the admin
 * app routes on, because the cookies carrying the answer are `HttpOnly`. Every
 * second-factor refusal on this controller is one uniform 401, and the routes
 * that can refuse one share a single tail ({@link issueAdminSession}) so they
 * cannot drift apart.
 *
 * Still out of this controller by WBS: `DELETE /v1/admin/users/:id/mfa` (EARS-13,
 * the LD-2 operator recovery), whose Issue is open and whose absence is stated
 * rather than papered over with a stub that would have to be un-built later.
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
    let outcome: AdminLoginOutcome;
    try {
      outcome = await this.admin.startLogin(
        dto.identifier,
        dto.password,
        fingerprint,
      );
    } catch (err) {
      // A genuine IdP infra fault (5xx / transport / an unroutable management
      // path — #1208) is "unavailable", carrying no detail that would separate
      // this caller from any other. Anything else keeps its own handling.
      if (err instanceof IdpUnavailableError) {
        throw new ServiceUnavailableException(GENERIC_ADMIN_UNAVAILABLE);
      }
      throw err;
    }
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
    const offer = await this.mapIdpFault(() =>
      this.admin.startEnrollment(
        ref,
        computeFingerprint({ userAgent, ip, acceptLanguage }),
      ),
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
    const outcome = await this.mapIdpFault(() =>
      this.admin.verifyEnrollment(
        ref,
        computeFingerprint({ userAgent, ip, acceptLanguage }),
        dto.code,
      ),
    );
    this.issueAdminSession(outcome, reply);
    return { state: "active" };
  }

  /**
   * EARS-6 — `VerifyMfaChallenge`. The second factor of every admin login after
   * the first. An **enrolled** `platform_admin` who completed primary auth holds
   * only a pending reference; a correct, unexpired, not-previously-used code
   * verified against their registered factor is the single thing that turns it
   * into `__Host-ds_admin_session` (upgraded in place, LD-1) — and nothing on the
   * admin surface is reachable until it does.
   *
   * `access: pending-auth` and the `mfa_challenge_required` step specifically: a
   * principal still owing enrollment cannot reach this route, and a caller
   * already holding an admin session is not pending and gets the same refusal.
   *
   * Every refusal — wrong code, expired window, replayed code, soft-locked
   * account, stale or foreign pending reference — is the same 401 with the same
   * body, under `@TimingEqualized()` (EARS-7). The pending authentication
   * survives it, so a mistyped code leaves the operator on the challenge screen
   * rather than back at the login form.
   */
  @Post("mfa/verify")
  @Public()
  @RateLimited()
  @TimingEqualized()
  @HttpCode(200)
  @Authz({
    access: "pending-auth",
    roles: ["platform_admin"],
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-6", "EARS-7"],
  })
  async verifyMfaChallenge(
    @Body() dto: AdminMfaCodeRequestDto,
    @Headers("cookie") cookieHeader: string | undefined,
    @Headers("user-agent") userAgent: string | undefined,
    @Headers("accept-language") acceptLanguage: string | undefined,
    @Ip() ip: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdminMfaVerifyResponse> {
    const ref = parseCookies(cookieHeader)[ADMIN_PENDING_COOKIE_NAME] ?? "";
    const outcome = await this.mapIdpFault(() =>
      this.admin.verifyChallenge(
        ref,
        computeFingerprint({ userAgent, ip, acceptLanguage }),
        dto.code,
      ),
    );
    this.issueAdminSession(outcome, reply);
    return { state: "active" };
  }

  /**
   * EARS-6 — `ReadAdminAuthState`. The one client-readable read the admin app
   * routes on: login form, enrollment screen, challenge screen, or the app.
   *
   * It exists because the three cookies that hold the answer are unreadable to
   * the app by design — `__Host-ds_admin_session` and `__Host-ds_admin_pending`
   * are `HttpOnly` — so "where am I in this flow?" has to be a server read. It
   * returns the state enum and NOTHING else: no attempt budget, no lock
   * indicator, no factor id, no subject (design §9, Read models). One disclosure
   * rule binds this route and the verify routes alike; a locked account's
   * response here is byte-identical to an unlocked one in the same state.
   *
   * `access: public` is the honest classification: it must answer a caller with
   * no credential at all (`unauthenticated`), which is precisely how the login
   * screen learns it should render the form. It is a read — no CSRF proof is owed
   * (EARS-10 covers state-changing methods) and none is asked for.
   */
  @Get("state")
  @Public()
  @HttpCode(200)
  // `audit: low-stakes` — a read that changes nothing and resolves no principal
  // owes no terminal ledger row; claiming `high-stakes` would advertise a row
  // nothing writes (endpoint-authz design §3).
  @Authz({
    access: "public",
    check: "none",
    audit: "low-stakes",
    tests: ["EARS-6"],
  })
  async readAuthState(
    @Headers("cookie") cookieHeader: string | undefined,
    @Headers("user-agent") userAgent: string | undefined,
    @Headers("accept-language") acceptLanguage: string | undefined,
    @Ip() ip: string,
  ): Promise<AdminAuthStateResponse> {
    const cookies = parseCookies(cookieHeader);
    const state = await this.admin.readState({
      sid: cookies[ADMIN_SESSION_COOKIE_NAME],
      pendingRef: cookies[ADMIN_PENDING_COOKIE_NAME],
      fingerprint: computeFingerprint({ userAgent, ip, acceptLanguage }),
    });
    return { state };
  }

  /**
   * The shared IdP-fault mapping of every pending-auth second-factor route
   * (EARS-5, EARS-6) — the mirror of the one `login` applies: a genuine IdP infra
   * fault is the same generic 503 "unavailable", never a bare 500 (#202, #1211).
   *
   * This is a security control, not cosmetics — for the same reason it is one on
   * `login`. The TOTP seam fails LOUD (#1208: `startTotpRegistration`,
   * `verifyTotpRegistration` and `checkTotpFactor` throw rather than resolve "not
   * verified", so an outage can never be reported as a wrong code). Unmapped, that
   * throw would surface a 500 — a THIRD answer beside the uniform 401 (EARS-7) and
   * the 429 — reachable only by a caller who already holds a live pending
   * authentication, i.e. one who passed primary auth on a `platform_admin`. The
   * outage must not become the one status that confirms it.
   *
   * All three pending-auth routes take it, not just the two verifies: an operator
   * whose enrollment START faults gets the same honest "come back later" as one
   * whose code check faults, and one unmapped sibling would be the only route on
   * this controller that still turns an outage into a 500.
   *
   * The mapping lives here, in the handler, so the terminal error still travels
   * through `TimingEqualizationInterceptor`'s padded branch, exactly like the
   * refusal it must be indistinguishable from in timing. An outage is not a failed
   * attempt: the throw leaves `verifyFactor` before its failure accounting, so no
   * `auth.mfa.failure` row is written and no lockout unit is spent.
   */
  private async mapIdpFault<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      if (err instanceof IdpUnavailableError) {
        throw new ServiceUnavailableException(GENERIC_ADMIN_UNAVAILABLE);
      }
      throw err;
    }
  }

  /**
   * The shared tail of both verify handlers (EARS-5, EARS-6): translate the
   * verification outcome into cookies or the uniform refusal.
   *
   * Written once because the two surfaces must be indistinguishable to a caller
   * (EARS-7) — including in status code, body, and which cookies come back. Two
   * copies would be two chances for one of them to grow a distinguishing detail.
   */
  private issueAdminSession(
    outcome: AdminMfaVerifyOutcome,
    reply: FastifyReply,
  ): void {
    if (outcome.status === "throttled") {
      throw new HttpException(
        GENERIC_ADMIN_THROTTLED,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (outcome.status !== "verified") {
      throw new UnauthorizedException(GENERIC_ADMIN_MFA_FAILURE);
    }
    // The admin session pair, plus the clearing of the pending cookie the
    // upgrade consumed — a pending reference never coexists with the session it
    // became (design §8).
    reply.header("set-cookie", [
      ...outcome.cookies,
      this.admin.clearPending(),
    ]);
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

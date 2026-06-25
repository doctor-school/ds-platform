import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Ip,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type {
  LoginResponse,
  LogoutResponse,
  OtpRequestResponse,
  PasswordResetCompleteResponse,
  PasswordResetResponse,
  RefreshResponse,
  RegisterResponse,
  SessionClaims,
  VerifyResendResponse,
  VerifyResponse,
  ZitadelWebhookResponse,
} from "@ds/schemas";
import { Authz, Public } from "../authz/index.js";
import { BotProtected } from "../bot-protection/index.js";
import { RateLimited, RateLimitService } from "./rate-limit/index.js";
import { TimingEqualized } from "./timing/index.js";
import {
  LoginChallenged,
  LoginChallengePolicy,
} from "./login-challenge/index.js";
import { AuthService } from "./auth.service.js";
import {
  LoginRequestDto,
  OtpRequestDto,
  OtpVerifyDto,
  PasswordResetCompleteRequestDto,
  PasswordResetRequestDto,
  RegisterRequestDto,
  VerifyRequestDto,
  VerifyResendRequestDto,
  ZitadelWebhookDto,
} from "./auth.dto.js";
import { WEBHOOK_SECRET_HEADER } from "./auth.tokens.js";
import {
  clearSessionCookie,
  computeFingerprint,
  parseCookies,
  SESSION_COOKIE_NAME,
} from "./session/session.cookie.js";

// One generic message for every login failure (unknown identifier, wrong
// password): the specific reason is an enumeration/oracle channel (EARS-16) and
// lives only in the audit ledger (F6). Same 401, same body, for every branch.
const GENERIC_LOGIN_FAILURE = "invalid credentials";

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
  // All deps are type-inferred (no `@Inject`), so the tsx/esbuild
  // `design:paramtypes` ordering hazard (a type-inferred param preceding an
  // `@Inject` one) does not apply — see the class doc above.
  constructor(
    private readonly auth: AuthService,
    private readonly loginChallenge: LoginChallengePolicy,
    // #222: forgive-on-success — clear the EARS-13 per-user window when a login or
    // a reset-complete succeeds (the guard consumed a unit before the outcome was
    // known; a success means the user is legitimate, so do not strand them).
    private readonly rateLimit: RateLimitService,
  ) {}

  /**
   * EARS-1: email-primary registration (#202). Public (unauthenticated entry point
   * that mints identity). Registration is email + password only — the phone-only
   * register channel and its register-time SMS-budget gate (EARS-14) were removed
   * (Zitadel cannot create a login-capable human without an email), so this no
   * longer threads the IP / ASN budget dimensions. Phone is a future
   * post-registration secondary identifier; SMS-OTP *login* still uses the budget.
   */
  @Post("register")
  @Public()
  @RateLimited()
  @TimingEqualized()
  @BotProtected("register")
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-1", "EARS-20", "EARS-16"],
  })
  register(@Body() dto: RegisterRequestDto): Promise<RegisterResponse> {
    return this.auth.register(dto);
  }

  /**
   * EARS-5 + EARS-8. Public (unauthenticated entry point that mints a session).
   * On success it sets the `__Host-` cookie and returns a token-free body; every
   * failure is the same generic 401 (EARS-16). The fingerprint is derived here —
   * the controller is the only layer with the request — and bound into the
   * session by the service. The login captcha-after-N-failures policy (EARS-17)
   * is enforced by `LoginChallengeGuard` via `@LoginChallenged()`: a normal first
   * login is unburdened, but once this origin has failed N times the guard
   * requires a bot-protection token. The controller feeds the policy the outcome
   * (the guard runs before the result is known) — a failure tallies, a success
   * clears the window.
   */
  @Post("login")
  @Public()
  @RateLimited()
  @TimingEqualized()
  @LoginChallenged()
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-5", "EARS-8", "EARS-17"],
  })
  async login(
    @Body() dto: LoginRequestDto,
    @Headers("user-agent") userAgent: string | undefined,
    @Headers("accept-language") acceptLanguage: string | undefined,
    @Ip() ip: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResponse> {
    const fingerprint = computeFingerprint({ userAgent, ip, acceptLanguage });
    const result = await this.auth.loginWithPassword(
      dto.identifier,
      dto.password,
      fingerprint,
    );
    if (!result) {
      // EARS-17: tally the failure for this origin; the N+1-th attempt is then
      // challenged by the guard. (The generic 401 is unchanged — EARS-16.)
      this.loginChallenge.recordFailure(ip);
      throw new UnauthorizedException(GENERIC_LOGIN_FAILURE);
    }

    // A successful login clears the origin's failure window (no lingering challenge)
    // and forgives the EARS-13 per-user rate-limit window for this identifier
    // (#222) — only the per-user window, keyed identically to how the guard keyed
    // it; the per-IP / per-ASN windows are deliberately left intact.
    this.loginChallenge.reset(ip);
    this.rateLimit.reset({ ip, identifier: dto.identifier });
    reply.header("set-cookie", result.cookie);
    return { status: "authenticated" };
  }

  /**
   * EARS-6/7 step 1: request a passwordless login code (email-OTP or SMS-OTP).
   * Public (unauthenticated entry point that mints no session yet). The SMS
   * channel is gated by the toll-fraud budget (EARS-14) in the service: the IP is
   * taken here (the only request-coupled input) and the ASN from the edge-supplied
   * `x-asn` header (the per-ASN limit is an edge/BFF concern, design §2; absent in
   * dev, the budget degrades to phone/IP/global). A budget-refused SMS is a
   * generic 429 thrown by the service — no SMS reaches the provider. The success
   * body is the same enumeration-safe `otp_sent` for both channels (EARS-16).
   * `audit: high-stakes` — a credential-channel side-effect (code send / SMS spend).
   */
  @Post("login/otp/request")
  @Public()
  @RateLimited()
  @TimingEqualized()
  @BotProtected("otp-request")
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-6", "EARS-7", "EARS-14"],
  })
  requestLoginOtp(
    @Body() dto: OtpRequestDto,
    @Ip() ip: string,
    @Headers("x-asn") asn: string | undefined,
  ): Promise<OtpRequestResponse> {
    return this.auth.requestLoginOtp(dto, { ip, asn });
  }

  /**
   * EARS-6/7 step 2 + EARS-8: submit a passwordless login code. Public (the code
   * is the authenticator; the user holds no session yet). On success it sets the
   * `__Host-` cookie and returns a token-free body — the identical convergence
   * point as password login (design §6); every failure is the same generic 401
   * (EARS-16). The fingerprint is derived here (the only layer with the request)
   * and bound into the session by the service.
   */
  @Post("login/otp")
  @Public()
  @RateLimited()
  @TimingEqualized()
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-6", "EARS-7", "EARS-8"],
  })
  async loginWithOtp(
    @Body() dto: OtpVerifyDto,
    @Headers("user-agent") userAgent: string | undefined,
    @Headers("accept-language") acceptLanguage: string | undefined,
    @Ip() ip: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResponse> {
    const fingerprint = computeFingerprint({ userAgent, ip, acceptLanguage });
    const result = await this.auth.loginWithOtp(dto, fingerprint);
    if (!result) throw new UnauthorizedException(GENERIC_LOGIN_FAILURE);

    reply.header("set-cookie", result.cookie);
    return { status: "authenticated" };
  }

  /**
   * EARS-8 read side: the authenticated principal (`sub, roles[], mfa`). Protected
   * — `doctor_guest` is the v1 authenticated baseline (design §7.2); the subject
   * is populated by `SessionAuthHook` from the `__Host-` cookie and the `AuthzGuard`
   * guarantees its presence before this handler runs. The access/refresh tokens
   * stay server-side and are never echoed here.
   */
  @Get("session")
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    check: "fast-path",
    audit: "low-stakes",
    tests: ["EARS-8"],
  })
  session(@Req() req: { user?: SessionClaims }): SessionClaims {
    return req.user as SessionClaims;
  }

  /**
   * EARS-9: rotate the session's refresh token. Authenticated — the `__Host-`
   * cookie still resolves to a live session even when its server-side access
   * token has expired (the cookie lifetime is the 30-day refresh lifetime, not
   * the 15-min access lifetime), so the auth hook populates the subject and the
   * guard admits the request; the rotation happens entirely server-side and no
   * token is returned. On reuse detection the chain is already invalidated and
   * the session revoked, so the now-dead cookie is cleared and the request is
   * denied. `audit: low-stakes` — rotation is routine and high-frequency
   * (canonical `auth.token.rotated`, ADR-0001 §7.3), not an introspection-tier
   * event.
   */
  @Post("refresh")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    check: "fast-path",
    audit: "low-stakes",
    tests: ["EARS-9"],
  })
  async refresh(
    @Headers("cookie") cookieHeader: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<RefreshResponse> {
    const sid = parseCookies(cookieHeader)[SESSION_COOKIE_NAME];
    const outcome = sid
      ? await this.auth.refreshSession(sid)
      : ({ status: "no_session" } as const);
    if (outcome.status === "rotated") return { status: "refreshed" };
    // reuse_detected (session already revoked) or no_session: clear the dead
    // cookie and deny. The generic 401 leaks nothing about which it was.
    reply.header("set-cookie", clearSessionCookie());
    throw new UnauthorizedException(GENERIC_LOGIN_FAILURE);
  }

  /**
   * EARS-10: log out. Authenticated (`doctor_guest` baseline, ADR-0001 §7.2) — you
   * must hold a live session to revoke it. Deletes the server-side session
   * (invalidating its refresh chain), clears the `__Host-` cookie, and records
   * `SessionRevoked` (canonical `auth.session.terminated`, reason `logout`).
   * `audit: high-stakes` — an explicit session-lifecycle command, like login.
   */
  @Post("logout")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    check: "fast-path",
    audit: "high-stakes",
    tests: ["EARS-10"],
  })
  async logout(
    @Headers("cookie") cookieHeader: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LogoutResponse> {
    const sid = parseCookies(cookieHeader)[SESSION_COOKIE_NAME];
    const { cookie } = await this.auth.logout(sid ?? "");
    reply.header("set-cookie", cookie);
    return { status: "logged_out" };
  }

  @Post("verify")
  @Public()
  @RateLimited()
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

  /**
   * EARS-25: resend the registration email verification code (#319). Public
   * (unauthenticated entry point — the existence-agnostic `/verify` screen,
   * EARS-24, calls it without the held password). The decorators mirror the other
   * abuse-prone unauthenticated message-spending surfaces (`password/reset`):
   * `@RateLimited` (EARS-13), `@TimingEqualized` (EARS-16's ≤50 ms budget), and
   * `@BotProtected("verify-resend")` (EARS-17; the guard no-ops until a provider
   * is configured). The body is the same `resend_requested` acknowledgement
   * whether or not the identifier exists or is already verified — a code is
   * re-issued only for an existing, unverified registrant, but the response,
   * status, and timing disclose nothing (enumeration-resistant, EARS-16).
   */
  @Post("verify/resend")
  @Public()
  @RateLimited()
  @TimingEqualized()
  @BotProtected("verify-resend")
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-25", "EARS-16"],
  })
  resendVerification(
    @Body() dto: VerifyResendRequestDto,
  ): Promise<VerifyResendResponse> {
    return this.auth.resendEmailVerification(dto.identifier);
  }

  /**
   * EARS-11: initiate a password reset. Public (unauthenticated entry point) and
   * `@BotProtected("password-reset")` — reset is an abuse-prone unauthenticated
   * surface (design §10.1, EARS-17), and the guard no-ops until a provider is
   * configured. The body is the same `reset_requested` acknowledgement whether or
   * not the identifier exists (enumeration-resistant, EARS-16).
   */
  @Post("password/reset")
  @Public()
  @RateLimited()
  @TimingEqualized()
  @BotProtected("password-reset")
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-11", "EARS-16"],
  })
  requestPasswordReset(
    @Body() dto: PasswordResetRequestDto,
  ): Promise<PasswordResetResponse> {
    return this.auth.requestPasswordReset(dto.identifier);
  }

  /**
   * EARS-12: complete a password reset and auto-log-in (#221). Public — the reset
   * code is the authenticator, not a session (the user has none yet). On success
   * the IdP sets the new password; the BFF revokes every PRIOR session of that
   * subject (global force-logout) and records `PasswordResetCompleted`, then mints
   * a FRESH authenticated session and sets the `__Host-` cookie — the identical
   * convergence point as login (design §6), returning a token-free body (EARS-8).
   * The fingerprint is derived here (the controller is the only layer with the
   * request), exactly as `login` does. A successful complete also forgives the
   * EARS-13 per-user rate-limit window (#222), so a forgot-password → reset flow is
   * not throttled. A bad/expired code is the same generic 400 (EARS-16), thrown by
   * the service.
   */
  @Post("password/reset/complete")
  @Public()
  @RateLimited()
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-12"],
  })
  async completePasswordReset(
    @Body() dto: PasswordResetCompleteRequestDto,
    @Headers("user-agent") userAgent: string | undefined,
    @Headers("accept-language") acceptLanguage: string | undefined,
    @Ip() ip: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PasswordResetCompleteResponse> {
    const fingerprint = computeFingerprint({ userAgent, ip, acceptLanguage });
    const { cookie, body } = await this.auth.completePasswordReset(
      dto.identifier,
      dto.code,
      dto.newPassword,
      fingerprint,
    );
    // Forgive the EARS-13 per-user window on success (#222), keyed identically to
    // the guard; mint the fresh session by setting its __Host- cookie.
    this.rateLimit.reset({ ip, identifier: dto.identifier });
    reply.header("set-cookie", cookie);
    return body;
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

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
  RefreshResponse,
  RegisterResponse,
  SessionClaims,
  VerifyResponse,
  ZitadelWebhookResponse,
} from "@ds/schemas";
import { Authz, Public } from "../authz/index.js";
import { BotProtected } from "../bot-protection/index.js";
import { AuthService } from "./auth.service.js";
import {
  LoginRequestDto,
  RegisterRequestDto,
  VerifyRequestDto,
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

  /**
   * EARS-5 + EARS-8. Public (unauthenticated entry point that mints a session).
   * On success it sets the `__Host-` cookie and returns a token-free body; every
   * failure is the same generic 401 (EARS-16). The fingerprint is derived here —
   * the controller is the only layer with the request — and bound into the
   * session by the service. The login captcha-after-N-failures policy (EARS-17
   * login surface) is owned by F6 (#90), so `login` is intentionally not yet
   * `@BotProtected`.
   */
  @Post("login")
  @Public()
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-5", "EARS-8"],
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
   * EARS-10: log out. Authenticated (`doctor_guest` baseline, design §7.2) — you
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

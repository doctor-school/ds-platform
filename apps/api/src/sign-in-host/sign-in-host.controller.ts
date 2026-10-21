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
  Query,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type {
  DoctorRegisterResponse,
  LoginHandoffResponse,
  OtpRequestResponse,
  PasswordResetResponse,
  RegisterResponse,
  SignInHostEntryResponse,
  SignInHostStepResponse,
  VerifyResendResponse,
} from "@ds/schemas";
import { Authz, Public } from "../authz/index.js";
import { BotProtected } from "../bot-protection/index.js";
import { AuthService, GENERIC_THROTTLED } from "../auth/auth.service.js";
import {
  LoginChallenged,
  LoginChallengePolicy,
} from "../auth/login-challenge/index.js";
import {
  ConsumedIpWindow,
  RateLimited,
  RateLimitService,
} from "../auth/rate-limit/index.js";
import {
  computeFingerprint,
  parseCookies,
} from "../auth/session/session.cookie.js";
import { TimingEqualized } from "../auth/timing/index.js";
import { readAuthVerifyTimingFloorMs } from "../auth/verify-timing.js";
import { DoctorRegisterService } from "../storefront/doctor-register.service.js";
import {
  FORM_COOKIE_NAME,
  RECORD_COOKIE_NAME,
} from "./sign-in-host.cookies.js";
import {
  SignInHostDoctorRegisterRequestDto,
  SignInHostDoctorVerifyRequestDto,
  SignInHostEntryQueryDto,
  SignInHostOtpRequestDto,
  SignInHostOtpVerifyDto,
  SignInHostPasswordRequestDto,
  SignInHostPasswordResetCompleteRequestDto,
  SignInHostPasswordResetRequestDto,
  SignInHostHandoffRequestDto,
  SignInHostRegisterRequestDto,
  SignInHostVerifyRequestDto,
  SignInHostVerifyResendRequestDto,
} from "./sign-in-host.dto.js";
import {
  SignInHostService,
  type CheckedForm,
  type HostRequest,
} from "./sign-in-host.service.js";

/** The storefront's one generic login refusal (EARS-16), byte-identical here. */
const GENERIC_LOGIN_FAILURE = "invalid credentials";

/**
 * Scope of the entry route's own per-address bucket (EARS-69: the entry takes
 * no identifier and is rate-limited; a page view never spends the EARS-13
 * credential budget).
 */
export const SIGN_IN_HOST_ENTRY_RATE_LIMIT_SCOPE = "sign-in-host:entry";

/** The request facts every handler reads, taken from the browser's own request. */
interface HostHeaders {
  cookie: string | undefined;
  userAgent: string | undefined;
  acceptLanguage: string | undefined;
  origin: string | undefined;
  secFetchSite: string | undefined;
}

/**
 * 003 EARS-5 (amended) / 60 / 64 / 66 / 67 / 68 / 69 / 70 / 71, ADR-0015 §4 —
 * the sign-in host's API (`/v1/sign-in-host/*`).
 *
 * Every credential route carries the very guards its storefront twin in
 * `AuthController` carries — `@RateLimited` (the same per-user / per-IP /
 * per-ASN windows, keyed identically, so one origin meets one ceiling across
 * both hosts), `@TimingEqualized`, `@BotProtected` / `@LoginChallenged`, the
 * SMS budget and the native lockout inside the shared `AuthService` steps —
 * and runs the same `AuthService` check (EARS-69, req. 8/9). The difference is
 * only where the checked session goes: into the shared sign-in-host record and
 * the auth request's finalisation, never into a storefront session.
 *
 * No route here sets a CORS header (none exist in this API); form posts are
 * refused unless same-origin with the CSRF token of the pre-existing form-state
 * cookie (req. 3). With the sign-in-host configuration unset every route is a
 * 404. Constructor deps are all type-inferred (the tsx/esbuild
 * `design:paramtypes` note on `AuthController`).
 */
@Controller({ path: "sign-in-host", version: "1" })
export class SignInHostController {
  constructor(
    private readonly host: SignInHostService,
    private readonly auth: AuthService,
    private readonly loginChallenge: LoginChallengePolicy,
    private readonly rateLimit: RateLimitService,
    private readonly doctorRegister: DoctorRegisterService,
  ) {}

  @Get("entry")
  @Public()
  @RateLimited(SIGN_IN_HOST_ENTRY_RATE_LIMIT_SCOPE)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-60", "EARS-64", "EARS-66", "EARS-67", "EARS-68", "EARS-71"],
  })
  async entry(
    @Query() query: SignInHostEntryQueryDto,
    @Headers("cookie") cookie: string | undefined,
    @Headers("user-agent") userAgent: string | undefined,
    @Headers("accept-language") acceptLanguage: string | undefined,
    @Ip() ip: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SignInHostEntryResponse> {
    const outcome = await this.host.entry(
      query.authRequest,
      hostRequest({ cookie, userAgent, acceptLanguage }, ip),
      { record: RECORD_COOKIE_NAME, form: FORM_COOKIE_NAME },
    );
    setCookies(reply, outcome.setCookies);
    return outcome.body;
  }

  /** EARS-5 (amended) — the password step on the host; `POST /v1/auth/login`'s guards. */
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
    tests: ["EARS-5", "EARS-64", "EARS-69", "EARS-70"],
  })
  async login(
    @Body() dto: SignInHostPasswordRequestDto,
    @Headers() headers: Record<string, string | undefined>,
    @Ip() ip: string,
    @ConsumedIpWindow() consumedIpWindow: number | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SignInHostStepResponse> {
    const h = readHeaders(headers);
    const form = await this.checkForm(h, dto);
    const req = hostRequest(h, ip);
    const result = await this.auth.passwordStep(
      dto.identifier,
      dto.password,
      this.host.acceptInto(form, req, RECORD_COOKIE_NAME),
    );
    if (!result) {
      this.loginChallenge.recordFailure(ip);
      throw new UnauthorizedException(GENERIC_LOGIN_FAILURE);
    }
    this.loginChallenge.reset(ip);
    this.rateLimit.reset({ ip, identifier: dto.identifier });
    this.rateLimit.refundIpUnit(ip, consumedIpWindow);
    setCookies(reply, result.setCookies);
    return { status: "redirect", url: result.url };
  }

  /** EARS-6/7 step 1 on the host — sends a code, mints nothing; `POST /v1/auth/login/otp/request`'s guards. */
  @Post("login/otp/request")
  @Public()
  @RateLimited({ door: "sending" })
  @TimingEqualized()
  @BotProtected("otp-request")
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-69", "EARS-70"],
  })
  async requestOtp(
    @Body() dto: SignInHostOtpRequestDto,
    @Headers() headers: Record<string, string | undefined>,
    @Ip() ip: string,
  ): Promise<OtpRequestResponse> {
    await this.checkForm(readHeaders(headers), dto);
    return this.auth.requestLoginOtp(
      { identifier: dto.identifier, channel: dto.channel },
      { ip, asn: headers["x-asn"] },
    );
  }

  /**
   * EARS-44 on the host — redeem the hand-off reference the spent entry intent
   * carried (the reference never crosses the browser), exactly as
   * `POST /v1/auth/login/otp/handoff` redeems a body reference. A form without
   * one, and every refused reference, is the one `handoff_refused`.
   */
  @Post("login/otp/handoff")
  @Public()
  @RateLimited({ door: "sending" })
  @TimingEqualized()
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-44", "EARS-69", "EARS-70", "EARS-71"],
  })
  async redeemHandoff(
    @Body() dto: SignInHostHandoffRequestDto,
    @Headers() headers: Record<string, string | undefined>,
    @Ip() ip: string,
  ): Promise<LoginHandoffResponse> {
    const form = await this.checkForm(readHeaders(headers), dto);
    const ref = this.host.handoffOf(form);
    const resolution = await this.auth.resolveLoginHandoff(ref, undefined);
    if (resolution === null || resolution.kind !== "send") {
      return { status: "handoff_refused" };
    }
    const email = resolution.identifier;
    if (!this.rateLimit.tryConsumeUser(email)) {
      throw new HttpException(GENERIC_THROTTLED, HttpStatus.TOO_MANY_REQUESTS);
    }
    await this.auth.requestLoginOtp(
      { identifier: email, channel: "email" },
      { ip, asn: headers["x-asn"] },
    );
    return { status: "otp_sent", identifier: email };
  }

  /** EARS-6/7 step 2 on the host; `POST /v1/auth/login/otp`'s guards. */
  @Post("login/otp")
  @Public()
  @RateLimited()
  @TimingEqualized()
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-5", "EARS-64", "EARS-69", "EARS-70"],
  })
  async loginWithOtp(
    @Body() dto: SignInHostOtpVerifyDto,
    @Headers() headers: Record<string, string | undefined>,
    @Ip() ip: string,
    @ConsumedIpWindow() consumedIpWindow: number | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SignInHostStepResponse> {
    const h = readHeaders(headers);
    const form = await this.checkForm(h, dto);
    const result = await this.auth.otpStep(
      { identifier: dto.identifier, code: dto.code, channel: dto.channel },
      this.host.acceptInto(form, hostRequest(h, ip), RECORD_COOKIE_NAME),
    );
    if (!result) throw new UnauthorizedException(GENERIC_LOGIN_FAILURE);
    this.rateLimit.reset({ ip, identifier: dto.identifier });
    this.rateLimit.refundIpUnit(ip, consumedIpWindow);
    setCookies(reply, result.setCookies);
    return { status: "redirect", url: result.url };
  }

  /**
   * EARS-24 (amended) — the Academy registration form on the host:
   * `POST /v1/auth/register`'s command and guards (sending door, timing
   * floor, captcha), the same enumeration-safe `pending_verification`. Mints
   * nothing; the code step below is the credential step. Only on a form the
   * Academy client opened.
   */
  @Post("register")
  @Public()
  @RateLimited({ door: "sending" })
  @TimingEqualized()
  @BotProtected("register")
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-24", "EARS-69", "EARS-70"],
  })
  async register(
    @Body() dto: SignInHostRegisterRequestDto,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<RegisterResponse> {
    const form = await this.checkForm(readHeaders(headers), dto);
    this.host.assertStorefront(form, "academy");
    const { authRequest: _a, csrf: _c, ...request } = dto;
    return this.auth.register(request);
  }

  /**
   * EARS-24 (amended) — the doctor registration form on the host:
   * `POST /v1/storefront/doctor/register`'s command (the 021 access
   * conditions, server-stamped consent versions) and guards. Only on a form
   * the doctor client opened.
   */
  @Post("storefront/doctor/register")
  @Public()
  @RateLimited({ door: "sending" })
  @TimingEqualized()
  @BotProtected("register")
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-24", "EARS-69", "EARS-70"],
  })
  async registerDoctor(
    @Body() dto: SignInHostDoctorRegisterRequestDto,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<DoctorRegisterResponse> {
    const form = await this.checkForm(readHeaders(headers), dto);
    this.host.assertStorefront(form, "doctor");
    const { authRequest: _a, csrf: _c, ...request } = dto;
    return this.doctorRegister.register(request);
  }

  /**
   * EARS-24 / 41 on the host — the doctor form's code step:
   * `POST /v1/storefront/doctor/verify`'s command and guards; the accepted
   * code is the EARS-5 credential step. Only on a form the doctor client opened.
   */
  @Post("storefront/doctor/verify")
  @Public()
  @RateLimited()
  @TimingEqualized()
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-5", "EARS-24", "EARS-64", "EARS-69", "EARS-70"],
  })
  async verifyDoctor(
    @Body() dto: SignInHostDoctorVerifyRequestDto,
    @Headers() headers: Record<string, string | undefined>,
    @Ip() ip: string,
    @ConsumedIpWindow() consumedIpWindow: number | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SignInHostStepResponse> {
    const h = readHeaders(headers);
    const form = await this.checkForm(h, dto);
    this.host.assertStorefront(form, "doctor");
    const { authRequest: _a, csrf: _c, ...request } = dto;
    const result = await this.doctorRegister.verifyStep(
      request,
      this.host.acceptInto(form, hostRequest(h, ip), RECORD_COOKIE_NAME),
    );
    this.rateLimit.reset({ ip, identifier: dto.email });
    this.rateLimit.refundIpUnit(ip, consumedIpWindow);
    setCookies(reply, result.setCookies);
    return { status: "redirect", url: result.url };
  }

  /** 003 EARS-3/41 — the Academy registration code step on the host; `POST /v1/auth/verify`'s guards. */
  @Post("verify")
  @Public()
  @RateLimited()
  @TimingEqualized({ floorMs: readAuthVerifyTimingFloorMs })
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-5", "EARS-64", "EARS-69", "EARS-70"],
  })
  async verify(
    @Body() dto: SignInHostVerifyRequestDto,
    @Headers() headers: Record<string, string | undefined>,
    @Ip() ip: string,
    @ConsumedIpWindow() consumedIpWindow: number | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SignInHostStepResponse> {
    const h = readHeaders(headers);
    const form = await this.checkForm(h, dto);
    this.host.assertStorefront(form, "academy");
    const result = await this.auth.verifyStep(
      {
        email: dto.email,
        code: dto.code,
        ...(dto.registration ? { registration: dto.registration } : {}),
      },
      this.host.acceptInto(form, hostRequest(h, ip), RECORD_COOKIE_NAME),
    );
    this.rateLimit.reset({ ip, identifier: dto.email });
    this.rateLimit.refundIpUnit(ip, consumedIpWindow);
    setCookies(reply, result.setCookies);
    return { status: "redirect", url: result.url };
  }

  /**
   * EARS-25 on the host — re-issue the registration code from the code step:
   * `POST /v1/auth/verify/resend`'s command and guards (sending door, timing
   * floor, captcha), the same enumeration-safe `resend_requested` (EARS-16).
   * Mints nothing; bound to the form like every host post.
   */
  @Post("verify/resend")
  @Public()
  @RateLimited({ door: "sending" })
  @TimingEqualized()
  @BotProtected("verify-resend")
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-25", "EARS-16", "EARS-70"],
  })
  async resendVerification(
    @Body() dto: SignInHostVerifyResendRequestDto,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<VerifyResendResponse> {
    await this.checkForm(readHeaders(headers), dto);
    return this.auth.resendEmailVerification(dto.identifier);
  }

  /** EARS-11 on the host — sends a reset code, mints nothing; `POST /v1/auth/password/reset`'s guards. */
  @Post("password/reset")
  @Public()
  @RateLimited({ door: "sending" })
  @TimingEqualized()
  @BotProtected("password-reset")
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-69", "EARS-70"],
  })
  async requestPasswordReset(
    @Body() dto: SignInHostPasswordResetRequestDto,
    @Headers() headers: Record<string, string | undefined>,
    @Ip() ip: string,
  ): Promise<PasswordResetResponse> {
    await this.checkForm(readHeaders(headers), dto);
    return this.auth.requestPasswordReset(dto.identifier, {
      ip,
      asn: headers["x-asn"],
    });
  }

  /** EARS-12 on the host; `POST /v1/auth/password/reset/complete`'s guards. */
  @Post("password/reset/complete")
  @Public()
  @RateLimited()
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-5", "EARS-64", "EARS-69", "EARS-70"],
  })
  async completePasswordReset(
    @Body() dto: SignInHostPasswordResetCompleteRequestDto,
    @Headers() headers: Record<string, string | undefined>,
    @Ip() ip: string,
    @ConsumedIpWindow() consumedIpWindow: number | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SignInHostStepResponse> {
    const h = readHeaders(headers);
    const form = await this.checkForm(h, dto);
    const result = await this.auth.resetCompleteStep(
      dto.identifier,
      dto.code,
      dto.newPassword,
      this.host.acceptInto(form, hostRequest(h, ip), RECORD_COOKIE_NAME),
    );
    this.rateLimit.reset({ ip, identifier: dto.identifier });
    this.rateLimit.refundIpUnit(ip, consumedIpWindow);
    setCookies(reply, result.setCookies);
    return { status: "redirect", url: result.url };
  }

  private checkForm(
    h: HostHeaders,
    dto: { csrf: string; authRequest: string },
  ): Promise<CheckedForm> {
    return this.host.checkFormPost({
      origin: h.origin,
      secFetchSite: h.secFetchSite,
      formCookieId: parseCookies(h.cookie)[FORM_COOKIE_NAME],
      csrf: dto.csrf,
      authRequest: dto.authRequest,
    });
  }
}

function readHeaders(headers: Record<string, string | undefined>): HostHeaders {
  return {
    cookie: headers["cookie"],
    userAgent: headers["user-agent"],
    acceptLanguage: headers["accept-language"],
    origin: headers["origin"],
    secFetchSite: headers["sec-fetch-site"],
  };
}

function hostRequest(
  h: Pick<HostHeaders, "cookie" | "userAgent" | "acceptLanguage">,
  ip: string,
): HostRequest {
  return {
    cookies: parseCookies(h.cookie),
    fingerprint: computeFingerprint({
      userAgent: h.userAgent,
      ip,
      acceptLanguage: h.acceptLanguage,
    }),
  };
}

function setCookies(reply: FastifyReply, cookies: string[]): void {
  if (cookies.length > 0) reply.header("set-cookie", cookies);
}

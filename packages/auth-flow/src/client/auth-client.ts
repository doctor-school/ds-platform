import type {
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  MyDisplayName,
  MyProfile,
  OtpRequest,
  OtpRequestResponse,
  OtpVerify,
  PasswordResetCompleteRequest,
  PasswordResetCompleteResponse,
  PasswordResetRequest,
  PasswordResetResponse,
  RefreshResponse,
  SessionClaims,
  SetDisplayNameRequest,
  VerifyResendRequest,
  VerifyResendResponse,
} from "@ds/schemas";

import type { AuthFlowApiConfig } from "../host-config";

/**
 * The ONE same-origin BFF auth client both storefronts mount (#2027, gate rows
 * 6–8, 18, 20).
 *
 * Every call goes to a RELATIVE path with `credentials: "include"`, so the
 * request rides the CALLING host's own origin and that host's `/v1/:path*`
 * rewrite proxies it to the api. That is the whole point of the same-origin
 * proxy: the `__Host-ds_session` cookie the BFF sets is origin-locked (`__Host-`
 * = no Domain, exact origin), so it is only ever set and sent on the host that
 * minted it, and the access/refresh tokens never reach this client (003 EARS-8).
 * An absolute base URL here would break both halves at once, which is why the
 * host states PATHS (`AuthFlowApiConfig`) and never an origin.
 *
 * Only the three paths that genuinely differ per host are data; every other
 * endpoint of the table below is a package constant, so neither storefront can
 * drift onto its own route for a shared command.
 */

/** The `PUT` behind the inline display-name edit — the same write on both hosts. */
const DISPLAY_NAME_PATH = "/v1/me/display-name";

/** The 003 EARS-27 account self-read — the same read on both hosts. */
const PROFILE_PATH = "/v1/me/profile";

/**
 * The header the api's bot-protection guard reads FIRST
 * (`apps/api/src/bot-protection/bot-protection.guard.ts`).
 *
 * ONE carrier for both storefronts (row 18): the token rides the header when one
 * exists and the header is ABSENT otherwise — never present-and-empty, which the
 * guard would read as a supplied-but-invalid token. The request body therefore
 * stays exactly the contract schema on every call.
 */
export const BOT_PROTECTION_TOKEN_HEADER = "x-smartcaptcha-token";

/**
 * A non-2xx BFF response — ONE envelope for every auth call of both hosts.
 *
 * The BFF keeps auth failures generic (003 EARS-16), so this carries only the
 * transport status plus the api's own machine-readable `code` when the body
 * carried one. Callers branch on `instanceof AuthError` and route through
 * `@ds/auth-flow/errors`; nothing user-facing reads `message`, which is the api's
 * own English text.
 *
 * `code` is a plain `string` rather than the bot-protection union: the api sends
 * codes this package does not enumerate, and narrowing them away here would make
 * a caller re-read the body to see what the api actually said.
 */
export class AuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** Best-effort code/message extraction; never discloses the BFF's internals. */
async function safeError(
  res: Response,
): Promise<{ message: string; code?: string }> {
  try {
    const data = (await res.json()) as { message?: unknown; code?: unknown };
    return {
      message:
        typeof data.message === "string"
          ? data.message
          : `request failed (${res.status})`,
      ...(typeof data.code === "string" ? { code: data.code } : {}),
    };
  } catch {
    // Non-JSON / empty body — fall through to the generic text.
  }
  return { message: `request failed (${res.status})` };
}

/**
 * Build the auth client for ONE host from the paths that host states.
 *
 * A factory rather than a module singleton because the register/confirm commands
 * differ per storefront (the Academy posts the 003 routes, the doctor host posts
 * its storefront commands); everything else is identical, so binding the paths
 * once at the host boundary keeps every CALL SITE path-free.
 */
export function createAuthClient(api: AuthFlowApiConfig) {
  const auth = (segment: string): string => `${api.basePath}/${segment}`;

  /**
   * POST a JSON body, returning the parsed token-free body. Throws
   * {@link AuthError} on a non-2xx so callers branch on the error type rather
   * than on transport details.
   */
  async function postJson<TReq, TRes>(
    path: string,
    body: TReq,
    captchaToken?: string,
  ): Promise<TRes> {
    const res = await fetch(path, {
      method: "POST",
      // Same-origin, but explicit: the session cookie must ride the request.
      credentials: "include",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(captchaToken
          ? { [BOT_PROTECTION_TOKEN_HEADER]: captchaToken }
          : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const error = await safeError(res);
      throw new AuthError(res.status, error.message, error.code);
    }
    // Some endpoints (logout/refresh) carry only a status; all are JSON.
    return (await res.json()) as TRes;
  }

  /**
   * GET a session-scoped read, answering `null` on a 401 instead of throwing so
   * the caller runs the 003 EARS-9 silent-refresh-then-retry dance without
   * try/catch noise. Any other non-2xx is a real failure and throws.
   */
  async function getOrNull<TRes>(path: string): Promise<TRes | null> {
    const res = await fetch(path, {
      method: "GET",
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (res.status === 401) return null;
    if (!res.ok) {
      const error = await safeError(res);
      throw new AuthError(res.status, error.message, error.code);
    }
    return (await res.json()) as TRes;
  }

  return {
    /**
     * 003 EARS-5 password sign-in. `POST /v1/auth/login` is `@LoginChallenged()`
     * — a captcha appears only after repeated failures — so the token is
     * optional here and simply absent on an ordinary first attempt (row 20).
     */
    login: (body: LoginRequest, captchaToken?: string) =>
      postJson<LoginRequest, LoginResponse>(auth("login"), body, captchaToken),

    /** 003 EARS-6/7 — issue a one-time sign-in code. `@BotProtected("otp-request")`. */
    requestOtp: (body: OtpRequest, captchaToken?: string) =>
      postJson<OtpRequest, OtpRequestResponse>(
        auth("login/otp/request"),
        body,
        captchaToken,
      ),

    /** 003 EARS-6/7 — exchange the one-time code for a session on this origin. */
    loginWithOtp: (body: OtpVerify) =>
      postJson<OtpVerify, LoginResponse>(auth("login/otp"), body),

    /** 003 EARS-11 — initiate recovery. `@BotProtected("password-reset")`. */
    requestPasswordReset: (body: PasswordResetRequest, captchaToken?: string) =>
      postJson<PasswordResetRequest, PasswordResetResponse>(
        auth("password/reset"),
        body,
        captchaToken,
      ),

    /** 003 EARS-12 — complete recovery with the emailed code and a new password. */
    completePasswordReset: (body: PasswordResetCompleteRequest) =>
      postJson<PasswordResetCompleteRequest, PasswordResetCompleteResponse>(
        auth("password/reset/complete"),
        body,
      ),

    /**
     * The host's registration command (003 EARS-1 on the Academy, 021 EARS-19
     * on the doctor storefront). Generic in the body/answer because the two
     * commands carry different contracts; the ROUTE is `api.registerPath` and
     * the bot-protection rule is the shared one.
     */
    register: <TReq, TRes>(body: TReq, captchaToken?: string) =>
      postJson<TReq, TRes>(api.registerPath, body, captchaToken),

    /**
     * The host's confirmation command. Deliberately takes NO token (row 20):
     * the confirmation submit is not a bot-protected route on either host, and
     * sending a spent token there would fail a check nothing asked for.
     */
    confirm: <TReq, TRes>(body: TReq) => postJson<TReq, TRes>(api.confirmPath, body),

    /** 003 EARS-25 — re-issue the registration code. `@BotProtected("verify-resend")`. */
    resendVerification: (body: VerifyResendRequest, captchaToken?: string) =>
      postJson<VerifyResendRequest, VerifyResendResponse>(
        auth("verify/resend"),
        body,
        captchaToken,
      ),

    /** 003 EARS-10 — revoke THIS origin's session server-side. */
    logout: () =>
      postJson<Record<string, never>, LogoutResponse>(auth("logout"), {}),

    /** 003 EARS-9 — rotate the session server-side; the silent-refresh retry. */
    refresh: () =>
      postJson<Record<string, never>, RefreshResponse>(auth("refresh"), {}),

    /** Read the authenticated principal (`sub, roles[], mfa`); `null` on a 401. */
    session: () => getOrNull<SessionClaims>(auth("session")),

    /** 003 EARS-27 — the account-profile self-read behind `/account`. */
    profile: () => getOrNull<MyProfile>(PROFILE_PATH),

    /** 006 EARS-14 — persist the display name through the one existing write. */
    async setDisplayName(body: SetDisplayNameRequest): Promise<MyDisplayName> {
      const res = await fetch(DISPLAY_NAME_PATH, {
        method: "PUT",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const error = await safeError(res);
        throw new AuthError(res.status, error.message, error.code);
      }
      return (await res.json()) as MyDisplayName;
    },
  };
}

/** The bound surface one host mounts — a screen wires ONE object, a test swaps ONE seam. */
export type AuthClient = ReturnType<typeof createAuthClient>;

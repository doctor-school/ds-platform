"use client";

import type {
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  OtpRequest,
  OtpRequestResponse,
  OtpVerify,
  PasswordResetCompleteRequest,
  PasswordResetCompleteResponse,
  PasswordResetRequest,
  PasswordResetResponse,
  RefreshResponse,
  RegisterRequest,
  RegisterResponse,
  SessionClaims,
  VerifyRequest,
  VerifyResendRequest,
  VerifyResendResponse,
  VerifyResponse,
} from "@ds/schemas";

/**
 * Same-origin BFF client for the portal auth journeys (#131).
 *
 * Every call goes to a RELATIVE `/v1/auth/*` path with `credentials: "include"`,
 * so the request rides the portal's own origin (Next `rewrites()` proxies it to
 * the api upstream — see `next.config.ts`). That is the whole point of the
 * same-origin proxy: the `__Host-ds_session` cookie the BFF sets is locked to the
 * portal origin (`__Host-` = no Domain, exact-origin), so it is only ever set and
 * sent here — never cross-origin, and the access/refresh tokens never reach this
 * client (EARS-8 invariant). These helpers therefore deal ONLY in the token-free
 * JSON bodies the BFF returns; there is no token plumbing to leak.
 *
 * The request shapes are the `@ds/schemas` SSOT types (the same ones the forms
 * validate with) — there is no portal-local re-declaration of the contract.
 */

const BASE = "/v1/auth";

/** A non-2xx BFF response. The BFF keeps failures generic (EARS-16); the portal
 * surfaces one neutral message and never tries to read an existence oracle out of
 * the status/body. */
export class AuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** POST a JSON body to a same-origin `/v1/auth/*` endpoint, returning the parsed
 * token-free body. Throws {@link AuthError} on a non-2xx so callers can branch on
 * `instanceof AuthError` without inspecting transport details. */
async function post<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    // Same-origin, but explicit: the session cookie must ride the request.
    credentials: "include",
  });
  if (!res.ok) {
    throw new AuthError(res.status, await safeMessage(res));
  }
  // Some endpoints (logout/refresh) carry only a status; all are JSON.
  return (await res.json()) as TRes;
}

/** Best-effort generic message extraction; never discloses the BFF's internals. */
async function safeMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: unknown };
    if (typeof data.message === "string") return data.message;
  } catch {
    // Non-JSON / empty body — fall through to the generic text.
  }
  return `request failed (${res.status})`;
}

export const authClient = {
  register: (body: RegisterRequest) =>
    post<RegisterRequest, RegisterResponse>("register", body),

  verify: (body: VerifyRequest) =>
    post<VerifyRequest, VerifyResponse>("verify", body),

  /**
   * Re-send the registration verification code (EARS-25, #319/#321). The
   * existence-agnostic `/verify` screen has no held password, so it cannot
   * re-`register` (the EARS-23 path); this dedicated endpoint re-issues the email
   * code with the identical enumeration-safe ack regardless of account state
   * (EARS-16).
   */
  resendVerification: (body: VerifyResendRequest) =>
    post<VerifyResendRequest, VerifyResendResponse>("verify/resend", body),

  login: (body: LoginRequest) =>
    post<LoginRequest, LoginResponse>("login", body),

  requestOtp: (body: OtpRequest) =>
    post<OtpRequest, OtpRequestResponse>("login/otp/request", body),

  loginWithOtp: (body: OtpVerify) =>
    post<OtpVerify, LoginResponse>("login/otp", body),

  requestPasswordReset: (body: PasswordResetRequest) =>
    post<PasswordResetRequest, PasswordResetResponse>("password/reset", body),

  completePasswordReset: (body: PasswordResetCompleteRequest) =>
    post<PasswordResetCompleteRequest, PasswordResetCompleteResponse>(
      "password/reset/complete",
      body,
    ),

  logout: () => post<Record<string, never>, LogoutResponse>("logout", {}),

  /** Rotate the session server-side (EARS-9). Used by the silent-refresh retry. */
  refresh: () => post<Record<string, never>, RefreshResponse>("refresh", {}),

  /**
   * Read the authenticated principal (`sub, roles[], mfa`). Returns `null` on a
   * 401 instead of throwing so the session shell can implement the EARS-9
   * silent-refresh-then-retry dance without try/catch noise.
   */
  async session(): Promise<SessionClaims | null> {
    const res = await fetch(`${BASE}/session`, {
      method: "GET",
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (res.status === 401) return null;
    if (!res.ok) throw new AuthError(res.status, await safeMessage(res));
    return (await res.json()) as SessionClaims;
  },
};

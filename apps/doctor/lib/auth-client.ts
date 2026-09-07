"use client";

import type {
  LoginRequest,
  LoginResponse,
  OtpRequest,
  OtpRequestResponse,
  OtpVerify,
  SessionClaims,
} from "@ds/schemas";

/**
 * Same-origin BFF client for the doctor storefront's auth journeys.
 *
 * Every call goes to a RELATIVE `/v1/auth/*` path with `credentials: "include"`,
 * so the request rides THIS origin and Next's `rewrites()` proxies it to the api
 * (`next.config.ts`). That is the whole point of the same-origin proxy: the
 * `__Host-ds_session` cookie the BFF sets is locked to `doctor.school`
 * (`__Host-` = no Domain, exact-origin), so it is only ever set and sent here —
 * never cross-origin — and the access/refresh tokens never reach this client
 * (003 EARS-8). These helpers therefore deal ONLY in the token-free JSON bodies
 * the BFF returns; there is no token plumbing to leak.
 *
 * The request/response shapes are the `@ds/schemas` SSOT types — the same ones
 * `apps/portal/lib/auth-client.ts` uses. This module deliberately mirrors that
 * portal file's SHAPE without importing from it: an app-to-app import is
 * forbidden (ADR-0013 A1 / AGENTS.md §6 host purity), and the shared thing here
 * is the CONTRACT, which already lives once in `@ds/schemas`. What is NOT
 * duplicated is the UI — the sign-in composition itself is the shared
 * `@ds/design-system/blocks` `<LoginCard>` (#1666), which both storefronts
 * project.
 *
 * The surface is deliberately narrow: the session probe plus the three sign-in
 * calls `/login` needs (#1933). Since 021 EARS-15 (#1996) `login` has a SECOND
 * caller — the registration screen replays it with the held credential once the
 * email is confirmed, because the confirm route mints no session — and that is
 * the same 003 EARS-5 command through the same origin proxy, not a registration
 * transport. Registration, verification and password recovery themselves stay
 * OUT of this module: they are the STOREFRONT commands
 * (`lib/storefront-auth-client.ts`, `/v1/storefront/doctor/*`), a different
 * contract with a different owner, and merging the two surfaces here would blur
 * which route mints a session.
 */

const BASE = "/v1/auth";

/**
 * A non-2xx BFF response.
 *
 * The BFF keeps login failures generic (003 EARS-16) — the doctor surface must
 * never read an existence oracle out of the status or the body — so this carries
 * only the transport status plus the api's own `code` when it sent one. Callers
 * branch on `instanceof AuthError` and map through `lib/auth-error-message.ts`;
 * nothing user-facing reads `message`, which is the api's own English text.
 */
export class AuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The api's machine-readable error code, when the body carried one. */
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
 * POST a JSON body to a same-origin `/v1/auth/*` endpoint, returning the parsed
 * token-free body. Throws {@link AuthError} on a non-2xx so callers branch on the
 * error type rather than on transport details.
 */
async function post<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    // Same-origin, but explicit: the session cookie must ride the request.
    credentials: "include",
  });
  if (!res.ok) {
    const error = await safeError(res);
    throw new AuthError(res.status, error.message, error.code);
  }
  return (await res.json()) as TRes;
}

/**
 * Client-side session probe for the doctor storefront.
 *
 * The 017 shell resolves the visitor's session SERVER-side
 * (`lib/shell-auth.ts`), so this read exists for client surfaces that need to
 * observe the session directly rather than through the rendered shell.
 */
export async function readSession(): Promise<SessionClaims | null> {
  const res = await fetch("/v1/auth/session", {
    method: "GET",
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`session request failed (${res.status})`);
  return (await res.json()) as SessionClaims;
}

/**
 * 003 EARS-5 password sign-in. On success the BFF sets the `__Host-ds_session`
 * cookie on THIS origin and answers a token-free body; the caller re-renders the
 * server tree (`router.refresh()`) so the 017 shell picks the session up.
 */
export function login(body: LoginRequest): Promise<LoginResponse> {
  return post<LoginRequest, LoginResponse>("login", body);
}

/** 003 EARS-6 (email) / EARS-7 (SMS) — issue a one-time sign-in code. */
export function requestOtp(body: OtpRequest): Promise<OtpRequestResponse> {
  return post<OtpRequest, OtpRequestResponse>("login/otp/request", body);
}

/** 003 EARS-6/7 — exchange the one-time code for a session on this origin. */
export function loginWithOtp(body: OtpVerify): Promise<LoginResponse> {
  return post<OtpVerify, LoginResponse>("login/otp", body);
}

/**
 * Grouped surface, so a screen wires ONE object and a test swaps ONE seam.
 * `readSession` keeps its named export — the 017 call sites import it directly.
 */
export const authClient = { readSession, login, requestOtp, loginWithOtp };

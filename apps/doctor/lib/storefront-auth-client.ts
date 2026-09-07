"use client";

import type {
  DoctorConfirmRequest,
  DoctorConfirmResponse,
  DoctorRegisterRequest,
  DoctorRegisterResponse,
  MyDisplayName,
  MyProfile,
  SetDisplayNameRequest,
  VerifyRequest,
  VerifyResendRequest,
  VerifyResendResponse,
  VerifyResponse,
} from "@ds/schemas";

/**
 * 021 EARS-19 (#1558) — the doctor storefront's client transport for the
 * registration and confirmation commands and the 003 code-resend call beside them.
 *
 * Same shape and same rules as `lib/auth-client.ts`'s session probe: a RELATIVE
 * `/v1/...` path with `credentials: "include"`, so the request rides THIS origin
 * and Next's rewrite proxies it to the api. That is the whole point of the
 * same-origin proxy — the `__Host-ds_session` cookie is locked to this host, and
 * the access/refresh tokens never reach this client.
 *
 * 021 defines NO second credential path and NO second code ENGINE. The register
 * and confirm commands are the storefront's own
 * (`POST /v1/storefront/doctor/register`, `POST /v1/storefront/doctor/confirm`),
 * and the confirm command exists for the ANSWER rather than the check: it
 * delegates the code to the shipped 003 engine unchanged and adds the 021
 * success state on top (021 EARS-10, #1546). Re-issuing a code stays the 003
 * route the Academy already calls (`/v1/auth/verify/resend`). Reused, not
 * re-implemented.
 */
const BASE = "/v1";

/**
 * A non-2xx from the BFF, carrying the stable machine-readable `code` so callers
 * branch on the contract rather than on a message. The shared bot-protection
 * predicates read exactly this field — they are class-agnostic on purpose, so
 * this error needs no relationship to the portal's `AuthError`.
 */
export class StorefrontAuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "StorefrontAuthError";
  }
}

async function safeError(
  res: Response,
): Promise<{ message: string; code?: string }> {
  try {
    const body = (await res.json()) as { message?: unknown; code?: unknown };
    return {
      message:
        typeof body.message === "string" ? body.message : `HTTP ${res.status}`,
      ...(typeof body.code === "string" ? { code: body.code } : {}),
    };
  } catch {
    return { message: `HTTP ${res.status}` };
  }
}

/**
 * POST a protected command.
 *
 * The 003 bot-protection guard reads the token from the `x-smartcaptcha-token`
 * HEADER FIRST and only then from a body field
 * (`apps/api/src/bot-protection/bot-protection.guard.ts`), so the token rides the
 * header — the body stays exactly the contract schema. With no token (the
 * provider disabled locally) the header is simply absent and the guard no-ops.
 */
async function post<TReq, TRes>(
  path: string,
  body: TReq,
  captchaToken?: string,
): Promise<TRes> {
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(captchaToken ? { "x-smartcaptcha-token": captchaToken } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const error = await safeError(res);
    throw new StorefrontAuthError(res.status, error.message, error.code);
  }
  return (await res.json()) as TRes;
}

/** 021 EARS-19 — `RegisterDoctor`, the storefront registration command. */
export function registerDoctor(
  body: DoctorRegisterRequest,
  captchaToken?: string,
): Promise<DoctorRegisterResponse> {
  return post<DoctorRegisterRequest, DoctorRegisterResponse>(
    "storefront/doctor/register",
    body,
    captchaToken,
  );
}

/** 003 EARS-3 — confirm the emailed registration code. Unchanged 003 engine. */
export function verifyEmail(body: VerifyRequest): Promise<VerifyResponse> {
  return post<VerifyRequest, VerifyResponse>("auth/verify", body);
}

/**
 * 003 EARS-25 — re-issue the registration code. `@BotProtected("verify-resend")`
 * on the api, so EVERY resend carries the token too (021 EARS-19 covers the
 * registration form AND the code-resend surface).
 */
export function resendVerification(
  body: VerifyResendRequest,
  captchaToken?: string,
): Promise<VerifyResendResponse> {
  return post<VerifyResendRequest, VerifyResendResponse>(
    "auth/verify/resend",
    body,
    captchaToken,
  );
}

/**
 * 003 EARS-27 (#1958) — the account-profile self-read behind `/account`.
 *
 * The SHIPPED 003 route, not a storefront copy: `GET /v1/me/profile` is the same
 * read the Academy calls, reached here through this origin's rewrite so the
 * `__Host-ds_session` cookie of `doctor.school` rides it. `null` on a 401 (no or
 * expired session) mirrors the portal client, so the caller runs the EARS-9
 * silent-refresh-then-redirect dance without try/catch noise; any other non-2xx
 * throws {@link StorefrontAuthError}.
 */
export async function getMyProfile(): Promise<MyProfile | null> {
  const res = await fetch(`${BASE}/me/profile`, {
    method: "GET",
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    const error = await safeError(res);
    throw new StorefrontAuthError(res.status, error.message, error.code);
  }
  return (await res.json()) as MyProfile;
}

/**
 * 006 EARS-14 (#1958) — persist the display name through the EXISTING write.
 *
 * `PUT /v1/me/display-name` is the one write behind the inline edit on both
 * storefronts; the storefront adds no second endpoint and no second validation —
 * the api re-checks the `@ds/schemas` SSOT rule server-side.
 */
export async function setDoctorDisplayName(
  body: SetDisplayNameRequest,
): Promise<MyDisplayName> {
  const res = await fetch(`${BASE}/me/display-name`, {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const error = await safeError(res);
    throw new StorefrontAuthError(res.status, error.message, error.code);
  }
  return (await res.json()) as MyDisplayName;
}

/**
 * 003 EARS-10 (#1958) — revoke this origin's session server-side.
 *
 * `__Host-` cookies are origin-locked (ADR-0015 §4), so signing out of
 * `doctor.school` revokes the doctor-host session only; the Academy session, if
 * one exists, is a separate cookie against the same Zitadel identity. The caller
 * decides where the doctor lands afterwards.
 */
export function logoutStorefront(): Promise<unknown> {
  return post<Record<string, never>, unknown>("auth/logout", {});
}

/**
 * 003 EARS-9 (#1958) — rotate this origin's session server-side.
 *
 * The SHIPPED 003 route again (`POST /v1/auth/refresh`); it exists here so the
 * storefront can run the same silent-refresh-then-retry dance the Academy runs
 * before it ever sends a doctor back to the door.
 */
export function refreshStorefrontSession(): Promise<unknown> {
  return post<Record<string, never>, unknown>("auth/refresh", {});
}

/**
 * 021 EARS-10 (#1546) — confirm the emailed code AND learn where to land, in ONE
 * round trip.
 *
 * `POST /v1/storefront/doctor/confirm` is not a second code path beside 003's
 * `/v1/auth/verify`: the storefront command DELEGATES to the same shipped 003
 * engine and then answers with the 021 success state (`credited`,
 * `profileCompletion`, the primary/secondary actions). So this surface calls it
 * INSTEAD of `verifyEmail`, never both — a client that called the 003 route and
 * then asked for a landing would verify the code twice.
 *
 * `returnTo` carries the DOCTOR-HOST projection of the arrival target
 * (`/events/<slug>`), which is the shape the server-side guard
 * `parseDoctorHostReturnTarget` accepts. It is re-validated there against the
 * live эфир, so nothing about this client's value is trusted: a stale, hostile
 * or absent target all resolve to a landing the server chose.
 */
export function confirmDoctorEmail(
  body: DoctorConfirmRequest,
): Promise<DoctorConfirmResponse> {
  return post<DoctorConfirmRequest, DoctorConfirmResponse>(
    "storefront/doctor/confirm",
    body,
  );
}

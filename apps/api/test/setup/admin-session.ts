import { expect } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  computeFingerprint,
  SESSION_COOKIE_NAME,
} from "../../src/auth/session/session.cookie.js";
import {
  ADMIN_CSRF_COOKIE_NAME,
  ADMIN_CSRF_HEADER,
  ADMIN_PENDING_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
} from "../../src/auth/admin-session/admin-session.cookie.js";
import { AdminSessionService } from "../../src/auth/admin-session/admin-session.service.js";

/**
 * Shared admin-tier session helper for the e2e suites (011 EARS-1/2/10).
 *
 * Since 011 an admin route authenticates **only** through
 * `__Host-ds_admin_session`; the doctor-portal cookie is refused there (EARS-2).
 * Every suite that drives `/v1/admin/**` therefore needs an admin session, and
 * this is the single place that arc is expressed.
 *
 * **Why it calls `upgradePending` directly.** Both verify handlers now exist
 * (EARS-5 in #1191, EARS-6 in #1192), so a suite COULD drive a full enrollment or
 * challenge over HTTP — and the two suites whose subject that is
 * (`mfa-enroll.e2e`, `mfa-challenge.e2e`) do exactly that. Every OTHER admin
 * suite wants a session, not a factor arc: routing them all through a TOTP
 * enrollment would make an unrelated failure in the factor seam fail a dozen
 * suites about events and separation, and would tie each of them to the 30-second
 * TOTP window. So this helper drives the real production path as far as the
 * pending reference and then calls the same service method the handlers call,
 * with the same fingerprint the request bound. Nothing here is a test-only code
 * path: it is the production seam, entered one hop past the factor check that the
 * factor suites own.
 */

/** The device headers the fingerprint is derived from; `app.inject` reports IP `127.0.0.1`. */
export const ADMIN_DEVICE: Record<string, string> = {
  "user-agent": "AdminTest/1.0",
  "accept-language": "en-US",
};

/** Fastify's `inject` always reports this client IP; the fingerprint must match it. */
const INJECT_IP = "127.0.0.1";

/**
 * `sid → csrfToken` for every admin session this helper minted, so a suite that
 * only carries the `sid` around (the shape the 007 suites already had for the
 * portal cookie) can still compose the EARS-10 double-submit header without
 * threading a second value through every call site.
 */
const csrfBySid = new Map<string, string>();

/**
 * Request headers for an admin session minted by {@link establishAdminSession}:
 * the admin cookie pair plus the EARS-10 CSRF double-submit header. Spread it
 * into a request's headers — `{ ...device, ...adminHeaders(sid) }`.
 */
export function adminHeaders(sid: string): Record<string, string> {
  const csrf = csrfBySid.get(sid);
  if (!csrf) {
    throw new Error(
      `no admin session minted for sid ${sid} — call establishAdminSession first`,
    );
  }
  return {
    cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sid}; ${ADMIN_CSRF_COOKIE_NAME}=${csrf}`,
    [ADMIN_CSRF_HEADER]: csrf,
  };
}

/**
 * Cookie headers for whichever tier this reference belongs to.
 *
 * The 007 suites carry a single opaque session reference around and format it
 * into a `Cookie` header at each call site. Since 011 that reference is an ADMIN
 * `sid` when the principal is a `platform_admin` and a PORTAL `sid` otherwise
 * (the `doctor_guest` negative cases) — and the two must be sent under different
 * cookie names, or the test would be asserting the wrong tier. This resolves the
 * tier from the mint registry, so the call sites stay one spread wide and no
 * suite can accidentally present a portal cookie while believing it holds an
 * admin session.
 */
export function authHeaders(sid: string): Record<string, string> {
  if (csrfBySid.has(sid)) return adminHeaders(sid);
  return { cookie: `${SESSION_COOKIE_NAME}=${sid}` };
}

export interface AdminSessionHandle {
  sub: string;
  sid: string;
  csrfToken: string;
  /** `Cookie` header value carrying the admin session + CSRF pair. */
  cookieHeader: string;
  /** Ready-to-spread request headers: device + cookies + the CSRF double-submit header. */
  headers: Record<string, string>;
  /** The same headers WITHOUT the CSRF header — for asserting the EARS-10 refusal. */
  headersWithoutCsrf: Record<string, string>;
}

/**
 * Log a registered `platform_admin` into the admin tier and return its session
 * handle. Fails the calling test if primary auth does not produce a pending
 * authentication (EARS-3) or the upgrade does not produce a session (EARS-1).
 */
export async function establishAdminSession(
  app: NestFastifyApplication,
  opts: {
    identifier: string;
    password: string;
    device?: Record<string, string>;
  },
): Promise<AdminSessionHandle> {
  const device = opts.device ?? ADMIN_DEVICE;

  const login = await app.inject({
    method: "POST",
    url: "/v1/admin/auth/login",
    headers: device,
    payload: { identifier: opts.identifier, password: opts.password },
  });
  expect(login.statusCode).toBe(200);

  const pending = login.cookies.find(
    (c) => c.name === ADMIN_PENDING_COOKIE_NAME,
  );
  expect(pending, "admin login must set the pending-auth cookie").toBeDefined();

  const fingerprint = computeFingerprint({
    userAgent: device["user-agent"],
    ip: INJECT_IP,
    acceptLanguage: device["accept-language"],
  });

  const admin = app.get(AdminSessionService);
  const upgraded = await admin.upgradePending(pending!.value, fingerprint);
  expect(
    upgraded,
    "pending auth must upgrade into an admin session",
  ).toBeDefined();

  const record = await admin.getBySid(upgraded!.principal.sid);
  expect(record).toBeDefined();

  csrfBySid.set(record!.sid, record!.csrfToken);
  const cookieHeader = `${ADMIN_SESSION_COOKIE_NAME}=${record!.sid}; ${ADMIN_CSRF_COOKIE_NAME}=${record!.csrfToken}`;
  const headersWithoutCsrf = { ...device, cookie: cookieHeader };

  return {
    sub: record!.sub,
    sid: record!.sid,
    csrfToken: record!.csrfToken,
    cookieHeader,
    headers: { ...headersWithoutCsrf, [ADMIN_CSRF_HEADER]: record!.csrfToken },
    headersWithoutCsrf,
  };
}

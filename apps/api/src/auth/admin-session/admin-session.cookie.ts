/**
 * 011 admin-tier cookie primitives (design §2, §3 — EARS-1, EARS-3, EARS-10).
 *
 * Three cookies, each with one job, all `__Host-` prefixed (a user agent rejects
 * a `__Host-` cookie unless it is `Secure`, `Path=/` and carries no `Domain`, so
 * the prefix itself enforces the ADR-0001 §6 host-only binding):
 *
 * - {@link ADMIN_SESSION_COOKIE_NAME} — the established admin session. Opaque
 *   server-side reference, `HttpOnly`, `SameSite=Strict`.
 * - {@link ADMIN_PENDING_COOKIE_NAME} — the short-lived pending-auth reference
 *   between primary auth and a satisfied second factor. **Not a session**: named
 *   distinctly so "is this a session?" is unambiguous at the hook, which reads
 *   only the session cookie (011 Constraints, design §3).
 * - {@link ADMIN_CSRF_COOKIE_NAME} — the readable half of the EARS-10
 *   double-submit pair. Deliberately NOT `HttpOnly` (the admin app must echo it
 *   into {@link ADMIN_CSRF_HEADER}); it carries no authority on its own.
 *
 * The names are fixed literals, not origins, so the AGENTS.md §9 "no hardcoded
 * origin/endpoint" rule does not apply — the origin binding is the prefix's job.
 */

/** EARS-1: the dedicated admin session cookie. */
export const ADMIN_SESSION_COOKIE_NAME = "__Host-ds_admin_session";

/** EARS-3: the pending-auth reference cookie (minutes, single-purpose). */
export const ADMIN_PENDING_COOKIE_NAME = "__Host-ds_admin_pending";

/** EARS-10: the readable half of the CSRF double-submit pair. */
export const ADMIN_CSRF_COOKIE_NAME = "__Host-ds_admin_csrf";

/** EARS-10: the header the admin app echoes {@link ADMIN_CSRF_COOKIE_NAME} into. */
export const ADMIN_CSRF_HEADER = "x-ds-admin-csrf";

/**
 * The admin **route** namespace. This is a URL path prefix owned by `apps/api`
 * (`@Controller({ path: "admin/…" })`), NOT an origin or an endpoint — so it is
 * the honest discriminator for "which cookie tier authenticates this request"
 * and carries no deployment coupling.
 */
const ADMIN_ROUTE_PREFIX = "/v1/admin/";

/**
 * The admin **auth-entry** routes: the ones a caller reaches *before* it holds an
 * admin session, where a missing or foreign cookie is the normal state rather
 * than a refused admin route — so the EARS-2 `auth.session.rejected` row is not
 * written for them.
 *
 * An explicit list, NOT the `/v1/admin/auth/` prefix. The prefix also covers
 * `POST /v1/admin/auth/logout`, which is an `access: authenticated` admin route:
 * a portal cookie (or a CSRF-mismatched admin session) presented there is exactly
 * the case EARS-2 mandates a row for, and exempting it would suppress that row.
 * The enrollment/challenge routes join this list with the handlers that make them
 * reachable on a pending reference (#1191/#1192) — an entry added before its
 * route exists is a hole with no test behind it.
 */
const ADMIN_AUTH_ENTRY_ROUTES: ReadonlySet<string> = new Set([
  "/v1/admin/auth/login",
]);

/** Strip the query string from a raw request URL, leaving the path. */
function pathOf(rawUrl: string): string {
  const q = rawUrl.indexOf("?");
  return q === -1 ? rawUrl : rawUrl.slice(0, q);
}

/**
 * EARS-2: does this request target the admin tier? Admin-tier requests resolve
 * their principal from {@link ADMIN_SESSION_COOKIE_NAME} **only**; a portal
 * cookie presented here authenticates nothing.
 */
export function isAdminRoute(rawUrl: string): boolean {
  return pathOf(rawUrl).startsWith(ADMIN_ROUTE_PREFIX);
}

/** Is this one of the admin auth-entry routes (see {@link ADMIN_AUTH_ENTRY_ROUTES})? */
export function isAdminAuthEntryRoute(rawUrl: string): boolean {
  return ADMIN_AUTH_ENTRY_ROUTES.has(pathOf(rawUrl));
}

/** HTTP methods that change state and therefore owe the EARS-10 double-submit proof. */
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** EARS-10: does this method change state (⇒ CSRF double-submit required)? */
export function isStateChangingMethod(method: string): boolean {
  return STATE_CHANGING_METHODS.has(method.toUpperCase());
}

/** Shared `__Host-` attribute set for the admin tier — `SameSite=Strict` (EARS-1). */
function adminCookie(
  name: string,
  value: string,
  opts: { maxAgeSeconds: number; httpOnly: boolean },
): string {
  const parts = [`${name}=${value}`, "Path=/"];
  if (opts.httpOnly) parts.push("HttpOnly");
  parts.push("Secure", "SameSite=Strict", `Max-Age=${opts.maxAgeSeconds}`);
  return parts.join("; ");
}

/**
 * EARS-1: serialize `__Host-ds_admin_session`. No `Domain` (host-only),
 * `Path=/`, `HttpOnly`, `Secure`, `SameSite=Strict`. `sid` is an opaque
 * server-side reference — never a token, never a claim payload.
 */
export function serializeAdminSessionCookie(
  sid: string,
  opts: { maxAgeSeconds: number },
): string {
  return adminCookie(ADMIN_SESSION_COOKIE_NAME, sid, {
    maxAgeSeconds: opts.maxAgeSeconds,
    httpOnly: true,
  });
}

/** EARS-2 logout: clear the admin session cookie (identical attribute set, `Max-Age=0`). */
export function clearAdminSessionCookie(): string {
  return adminCookie(ADMIN_SESSION_COOKIE_NAME, "", {
    maxAgeSeconds: 0,
    httpOnly: true,
  });
}

/** EARS-3: serialize the pending-auth reference cookie. */
export function serializeAdminPendingCookie(
  ref: string,
  opts: { maxAgeSeconds: number },
): string {
  return adminCookie(ADMIN_PENDING_COOKIE_NAME, ref, {
    maxAgeSeconds: opts.maxAgeSeconds,
    httpOnly: true,
  });
}

/** EARS-3: clear the pending-auth cookie (on upgrade to a session, or on expiry). */
export function clearAdminPendingCookie(): string {
  return adminCookie(ADMIN_PENDING_COOKIE_NAME, "", {
    maxAgeSeconds: 0,
    httpOnly: true,
  });
}

/**
 * EARS-10: serialize the readable CSRF cookie. Not `HttpOnly` **by design** —
 * the double-submit pattern requires the client to read it and echo it into
 * {@link ADMIN_CSRF_HEADER}; the value authenticates nothing by itself, it only
 * proves the request was composed by script running at the admin origin.
 */
export function serializeAdminCsrfCookie(
  token: string,
  opts: { maxAgeSeconds: number },
): string {
  return adminCookie(ADMIN_CSRF_COOKIE_NAME, token, {
    maxAgeSeconds: opts.maxAgeSeconds,
    httpOnly: false,
  });
}

/** EARS-10: clear the CSRF cookie alongside the session it belongs to. */
export function clearAdminCsrfCookie(): string {
  return adminCookie(ADMIN_CSRF_COOKIE_NAME, "", {
    maxAgeSeconds: 0,
    httpOnly: false,
  });
}

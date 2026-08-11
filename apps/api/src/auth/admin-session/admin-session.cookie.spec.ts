import { describe, expect, it } from "vitest";
import {
  ADMIN_CSRF_COOKIE_NAME,
  ADMIN_PENDING_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
  clearAdminPendingCookie,
  clearAdminSessionCookie,
  isAdminAuthEntryRoute,
  isAdminRoute,
  isStateChangingMethod,
  serializeAdminCsrfCookie,
  serializeAdminPendingCookie,
  serializeAdminSessionCookie,
} from "./admin-session.cookie.js";

describe("011 EARS-1/EARS-2/EARS-10 — admin-tier cookie primitives", () => {
  it("EARS-1: the session cookie carries the full __Host- attribute set with SameSite=Strict", () => {
    const cookie = serializeAdminSessionCookie("opaque-sid", {
      maxAgeSeconds: 60,
    });
    expect(cookie).toContain(`${ADMIN_SESSION_COOKIE_NAME}=opaque-sid`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    // A Domain attribute voids the `__Host-` prefix — host-only is the control.
    expect(cookie).not.toContain("Domain");
  });

  it("EARS-2: the clearing cookie repeats the identical attribute set with Max-Age=0", () => {
    const cleared = clearAdminSessionCookie();
    expect(cleared).toContain(`${ADMIN_SESSION_COOKIE_NAME}=;`);
    expect(cleared).toContain("Path=/");
    expect(cleared).toContain("HttpOnly");
    expect(cleared).toContain("Secure");
    expect(cleared).toContain("SameSite=Strict");
    expect(cleared).toContain("Max-Age=0");
  });

  it("EARS-3: the pending cookie is distinctly named and equally strict", () => {
    const cookie = serializeAdminPendingCookie("ref", { maxAgeSeconds: 300 });
    expect(cookie).toContain(`${ADMIN_PENDING_COOKIE_NAME}=ref`);
    expect(cookie).not.toContain(ADMIN_SESSION_COOKIE_NAME);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(clearAdminPendingCookie()).toContain("Max-Age=0");
  });

  it("EARS-10: the CSRF cookie is readable by design — double-submit needs the client to echo it", () => {
    const cookie = serializeAdminCsrfCookie("token", { maxAgeSeconds: 60 });
    expect(cookie).toContain(`${ADMIN_CSRF_COOKIE_NAME}=token`);
    expect(cookie).not.toContain("HttpOnly");
    // Still host-only + Strict — it is readable, not loose.
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).not.toContain("Domain");
  });

  it("EARS-2: the admin route namespace is recognised, and the portal namespace is not", () => {
    expect(isAdminRoute("/v1/admin/events")).toBe(true);
    expect(isAdminRoute("/v1/admin/events?state=draft")).toBe(true);
    expect(isAdminRoute("/v1/admin/auth/login")).toBe(true);
    expect(isAdminRoute("/v1/auth/session")).toBe(false);
    expect(isAdminRoute("/v1/me")).toBe(false);
    // Not a prefix match on a lookalike path.
    expect(isAdminRoute("/v1/administrators")).toBe(false);
  });

  it("EARS-2: the admin auth-entry set is exactly the routes reached without a session", () => {
    expect(isAdminAuthEntryRoute("/v1/admin/auth/login")).toBe(true);
    expect(isAdminAuthEntryRoute("/v1/admin/auth/login?next=/")).toBe(true);
    expect(isAdminAuthEntryRoute("/v1/admin/events")).toBe(false);
    // NOT the whole `/v1/admin/auth/` prefix: logout is an authenticated admin
    // route, so a refusal there owes its EARS-2 `auth.session.rejected` row.
    expect(isAdminAuthEntryRoute("/v1/admin/auth/logout")).toBe(false);
    // EARS-4/EARS-5 (#1191): the two enrollment endpoints are reached with a
    // PENDING reference and no session by design, so a refusal there is the
    // normal state rather than a refused admin route — they join the set with
    // the handlers that made them reachable.
    expect(isAdminAuthEntryRoute("/v1/admin/auth/mfa/enroll/start")).toBe(true);
    expect(isAdminAuthEntryRoute("/v1/admin/auth/mfa/enroll/verify")).toBe(true);
    // Still an explicit set, not the `/mfa/` prefix: the EARS-6 challenge route
    // joins with #1192, and a lookalike path is not pre-exempted.
    expect(isAdminAuthEntryRoute("/v1/admin/auth/mfa/verify")).toBe(false);
    expect(isAdminAuthEntryRoute("/v1/admin/auth/mfa/enroll")).toBe(false);
  });

  it("EARS-10: state-changing methods are exactly the ones that owe a CSRF proof", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      expect(isStateChangingMethod(m)).toBe(true);
    }
    for (const m of ["GET", "HEAD", "OPTIONS"]) {
      expect(isStateChangingMethod(m)).toBe(false);
    }
  });
});

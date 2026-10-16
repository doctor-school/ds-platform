import { describe, expect, it } from "vitest";

import {
  ADMIN_LANDING,
  RETURN_TARGET_PARAM,
  adminLandingFor,
  resolveAdminReturnTarget,
  returnTargetFromSearch,
  withAdminReturnTarget,
} from "./admin-return-target";

/**
 * #2782 — after signing in, the admin lands on the page they came from, not on
 * `/events` every time. The target rides as a URL parameter through
 * `/login` → `/mfa/challenge|enroll` → landing, so it is attacker-writable: a
 * link `/login?to=https://evil.example` must never become an open redirect, and
 * the sign-in screens themselves are never a destination (no `/login` loops).
 */
describe("resolveAdminReturnTarget — what a carried target may be", () => {
  it("#2782: keeps an admin path with its query", () => {
    expect(resolveAdminReturnTarget("/events/123?tab=x")).toBe(
      "/events/123?tab=x",
    );
  });

  it("#2782: keeps a hash fragment on an admin path", () => {
    expect(resolveAdminReturnTarget("/projects/7#partners")).toBe(
      "/projects/7#partners",
    );
  });

  it.each([
    ["absent", undefined],
    ["null", null],
    ["empty", ""],
    ["external absolute", "https://evil.example/events"],
    ["protocol-relative", "//evil.example/events"],
    ["javascript: scheme", "javascript:alert(1)"],
    ["data: scheme", "data:text/html,x"],
    ["backslash host", "/\\evil.example"],
    ["encoded backslash", "/%5Cevil.example"],
    ["relative path", "events/1"],
    ["control character", "/events\n/1"],
    ["the login screen", "/login"],
    ["the login screen with a query", "/login?to=%2Fevents"],
    ["the challenge screen", "/mfa/challenge"],
    ["the enrollment screen", "/mfa/enroll"],
    ["the mfa root", "/mfa"],
    ["the API proxy", "/v1/admin/events"],
    ["Next internals", "/_next/static/chunk.js"],
    ["the bare root", "/"],
  ])("#2782: refuses %s", (_label, raw) => {
    expect(resolveAdminReturnTarget(raw)).toBeNull();
  });

  // Parser differential: the validator and the browser / Next router must not
  // read one string two ways. WHATWG strips tab/newline and treats `\` as `/`,
  // and a decoded `%2F%2F` / `%5C` / `%09` can re-form a protocol-relative URL.
  it.each([
    ["backslash host", "/\\evil.com"],
    ["encoded backslash", "/%5Cevil.com"],
    ["tab-split slashes", "/\t/evil.com"],
    ["encoded tab-split slashes", "/%09/evil.com"],
    ["protocol-relative", "//evil.com"],
    ["encoded protocol-relative", "/%2F%2Fevil.com"],
    ["encoded single slash pair", "/%2Fevil.com"],
    ["scheme without slashes", "https:evil.com"],
    ["javascript scheme", "javascript:alert(1)"],
    ["double backslash", "\\\\evil.com"],
    ["space", "/ /evil.com"],
    ["encoded newline", "/%0a/evil.com"],
    ["malformed escape", "/events/%E0%A4%A"],
    // Dot-segment normalisation yields `/%2fevil`, which decodes to `//evil`.
    ["normalised to encoded protocol-relative", "/%2e%2e/%2fevil"],
  ])("#2782 security: refuses %s", (_label, raw) => {
    expect(resolveAdminReturnTarget(raw)).toBeNull();
  });

  // The returned target is re-validated at every hop, so it must be a fixed
  // point: validating an accepted target again returns it unchanged.
  it.each([
    "/events/123?tab=x",
    "/projects/7#partners",
    "/events/1?x=//evil.com",
    "/events/./1/../2?a=1",
    "/login-audit",
    "/events/..%2F..%2F/evil",
    "/%2e%2e/%2fevil",
    "/%2e%2e//evil",
    "/a/..//evil",
    "/events/%2e%2e/login",
    "/@evil.com",
    "/;//evil",
    "/events#//evil",
    "/%252F%252Fevil",
  ])("#2782 security: validation is idempotent for %s", (raw) => {
    const once = resolveAdminReturnTarget(raw);
    expect(resolveAdminReturnTarget(once)).toBe(once);
  });

  it("#2782 security: `//` inside the query is data, not a host — kept", () => {
    expect(resolveAdminReturnTarget("/events/1?x=//evil.com")).toBe(
      "/events/1?x=//evil.com",
    );
  });

  it("#2782 security: returns the rebuilt parsed URL, not the raw input", () => {
    expect(resolveAdminReturnTarget("/events/./1/../2?a=1")).toBe(
      "/events/2?a=1",
    );
  });

  it("#2782: a path merely starting with an auth word is still an admin page", () => {
    expect(resolveAdminReturnTarget("/login-audit")).toBe("/login-audit");
  });
});

describe("adminLandingFor — where a completed sign-in lands", () => {
  it("#2782: a valid target wins", () => {
    expect(adminLandingFor("/events/123?tab=x")).toBe("/events/123?tab=x");
  });

  it("#2782: anything else falls back to /events", () => {
    expect(ADMIN_LANDING).toBe("/events");
    expect(adminLandingFor("https://evil.example")).toBe("/events");
    expect(adminLandingFor("/login")).toBe("/events");
    expect(adminLandingFor(null)).toBe("/events");
  });
});

describe("withAdminReturnTarget / returnTargetFromSearch — carrying it across a hop", () => {
  it("#2782: uses Refine's `to` parameter (what <Authenticated> already appends)", () => {
    expect(RETURN_TARGET_PARAM).toBe("to");
  });

  it("#2782: appends a valid target, encoded, and reads it back", () => {
    const href = withAdminReturnTarget("/mfa/challenge", "/events/123?tab=x");
    expect(href).toBe("/mfa/challenge?to=%2Fevents%2F123%3Ftab%3Dx");
    expect(returnTargetFromSearch(href.slice(href.indexOf("?")))).toBe(
      "/events/123?tab=x",
    );
  });

  it("#2782: drops a rejected target instead of carrying it", () => {
    expect(withAdminReturnTarget("/login", "//evil.example")).toBe("/login");
    expect(withAdminReturnTarget("/login", "/login?to=%2Fevents")).toBe(
      "/login",
    );
  });

  it("#2782: reading a hostile search parameter yields nothing", () => {
    expect(returnTargetFromSearch("?to=https%3A%2F%2Fevil.example")).toBeNull();
    expect(returnTargetFromSearch("")).toBeNull();
  });
});

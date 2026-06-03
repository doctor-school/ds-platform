import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE_NAME,
  computeFingerprint,
  ipToNet24,
  parseCookies,
  serializeSessionCookie,
} from "./session.cookie.js";

// EARS-8 cookie/fingerprint primitives (design §3). Pure logic, unit-tested in
// isolation from the request lifecycle: the `__Host-` attribute set is a security
// invariant (a missing `Secure`/`Path=/` or a present `Domain` voids the prefix),
// and the fingerprint must be deterministic so re-derivation in the middleware
// matches the value stored at login.
describe("session cookie", () => {
  it("serializes a __Host- cookie with the mandatory attribute set and no Domain", () => {
    const cookie = serializeSessionCookie("the-sid", { maxAgeSeconds: 1800 });

    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=the-sid`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=1800");
    // __Host- prefix is void if a Domain is present.
    expect(cookie).not.toMatch(/Domain=/i);
    // The name itself must carry the __Host- prefix.
    expect(SESSION_COOKIE_NAME.startsWith("__Host-")).toBe(true);
  });

  it("parses a named cookie out of the request header and tolerates absence", () => {
    const header = `${SESSION_COOKIE_NAME}=abc123; other=ignored`;
    expect(parseCookies(header)[SESSION_COOKIE_NAME]).toBe("abc123");
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("")[SESSION_COOKIE_NAME]).toBeUndefined();
  });

  it("masks an IPv4 address to its /24 network", () => {
    expect(ipToNet24("203.0.113.42")).toBe("203.0.113.0");
    // Non-IPv4 (IPv6 / unknown) is returned unchanged — still a stable bucket.
    expect(ipToNet24("::1")).toBe("::1");
  });

  it("computes a deterministic fingerprint that changes with the user agent", () => {
    const base = {
      userAgent: "UA/1.0",
      ip: "203.0.113.42",
      acceptLanguage: "en",
    };
    const fp = computeFingerprint(base);

    // Deterministic for identical inputs (so the middleware re-derivation matches).
    expect(computeFingerprint(base)).toBe(fp);
    // Same /24 → same fingerprint (host bits are intentionally not bound).
    expect(computeFingerprint({ ...base, ip: "203.0.113.99" })).toBe(fp);
    // A different UA is a different device → different fingerprint.
    expect(computeFingerprint({ ...base, userAgent: "UA/2.0" })).not.toBe(fp);
  });
});

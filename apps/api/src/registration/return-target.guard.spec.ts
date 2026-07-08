import { describe, expect, it } from "vitest";
import {
  RegistrationIntentSchema,
  isSafeReturnTarget,
  parseReturnTarget,
} from "@ds/schemas";

// 005 EARS-2 — the guest-through-auth completion carries a SAFE, same-origin
// registration-intent (the event slug + a `/webinars/<slug>` return target only —
// never PII, never a credential) through the shipped 003 login/signup round-trip,
// and a cross-origin / open-redirect return target is rejected (requirements
// Constraints; design §3.2). The guard is the framework-agnostic SSOT in
// `@ds/schemas` (consumed by the portal on both sides of the handoff); this unit
// pins its accept/reject contract — the browser round-trip itself is the
// `apps/portal/e2e/registration-guest.spec.ts` Playwright deliverable.
//
// The describe title OPENS with `005 EARS-2 ` — the ears-test-lint feature scope
// prefix (a mid-title parenthesis does not scope).
describe("005 EARS-2 registration-intent return-target guard", () => {
  it("EARS-2: when a guest activates «Участвовать», the system shall accept only a same-origin return target + event slug", () => {
    const intent = parseReturnTarget("/webinars/ahilles-042");
    expect(intent).toEqual({
      eventSlug: "ahilles-042",
      returnTo: "/webinars/ahilles-042",
    });
    expect(isSafeReturnTarget("/webinars/ahilles-042")).toBe(true);
  });

  it("EARS-2: the intent carries the canonical same-origin returnTo derived from the validated slug", () => {
    // A safe target round-trips to exactly `/webinars/<slug>` — a same-origin
    // relative path, never a hardcoded origin (Constraints: no hardcoded origin).
    const intent = parseReturnTarget("/webinars/cardio-2026");
    expect(intent).not.toBeNull();
    expect(intent!.returnTo.startsWith("/webinars/")).toBe(true);
    expect(intent!.returnTo).not.toMatch(/^https?:/i);
    expect(intent!.returnTo).not.toMatch(/^\/\//);
  });

  it("EARS-2: the system shall reject a cross-origin / open-redirect return target", () => {
    for (const evil of [
      "https://evil.example/webinars/x", // absolute cross-origin scheme
      "http://evil.example", // absolute cross-origin scheme
      "//evil.example", // protocol-relative
      "//evil.example/webinars/x", // protocol-relative under a look-alike path
      "/\\evil.example", // backslash bypass (browsers may read as //)
      "/webinars/\\..\\account", // backslash traversal
      "/account", // same-origin but NOT an event return target
      "/webinars/", // no slug
      "/webinars/a/b", // multi-segment (not a single event slug)
      "/webinars/../account", // path traversal
      "/webinars/%2e%2e%2faccount", // encoded traversal
      "/webinars/%2fevil", // encoded separator
      "/webinars/has space", // whitespace injection
      "/webinars/x?next=//evil", // query injection
      "/webinars/x#//evil", // hash injection
      "webinars/x", // not absolute (no leading slash)
    ]) {
      expect(parseReturnTarget(evil), `must reject: ${evil}`).toBeNull();
      expect(isSafeReturnTarget(evil)).toBe(false);
    }
  });

  it("EARS-2: the system shall reject a non-string return target", () => {
    for (const bad of [null, undefined, 42, {}, ["/webinars/x"]]) {
      expect(parseReturnTarget(bad)).toBeNull();
    }
  });

  it("EARS-2: the system shall reject a PII/credential-laden intent payload — the intent carries event context only", () => {
    const base = { eventSlug: "ahilles-042", returnTo: "/webinars/ahilles-042" };
    // The bare event context is a valid intent…
    expect(RegistrationIntentSchema.safeParse(base).success).toBe(true);
    // …but any extra field (a credential, an identifier, a token, a raw password)
    // is rejected by the strict schema — the intent must never smuggle PII or a
    // credential across the round-trip (Constraints).
    for (const leak of [
      { password: "Aa1!longenough" },
      { email: "doc@example.com" },
      { phone: "+15551234567" },
      { token: "eyJhbGciOi.J.J" },
      { returnToOverride: "https://evil.example" },
    ]) {
      const result = RegistrationIntentSchema.safeParse({ ...base, ...leak });
      expect(result.success, `must reject leak: ${Object.keys(leak)[0]}`).toBe(
        false,
      );
    }
  });
});

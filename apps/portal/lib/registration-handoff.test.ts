import { describe, expect, it } from "vitest";

import { buildRegistrationHref } from "./registration-handoff";

/**
 * 004 EARS-3 — the event-context handoff the single «Участвовать» CTA carries
 * into the registration flow (feature 005) through auth (feature 003).
 *
 * 004 owns only the CTA and the context handoff; 005 owns the registration
 * mechanics and the guest→auth→registered round-trip. The contract 005's design
 * pins (§3.2) is a **safe, same-origin registration-intent**: the event slug + a
 * same-origin `returnTo=/webinars/:slug` path only — never PII, never a
 * credential, and a cross-origin / open return target is a banned pattern
 * (open-redirect). This unit pins that the href 004 emits satisfies that
 * contract; the browser-level "exactly one CTA + click enters the flow" lives in
 * the Playwright E2E (verification table EARS-3).
 */
describe("buildRegistrationHref (004 EARS-3 context handoff)", () => {
  it("EARS-3: when the event page builds the «Участвовать» CTA, the system shall route into the registration entry carrying the event as a same-origin returnTo", () => {
    const href = buildRegistrationHref("ahilles-042");

    // Routes into the registration/auth flow (003 entry, reused by 005)…
    expect(href.startsWith("/register?")).toBe(true);
    // …as a same-origin relative path (no hardcoded origin — 004 Constraints).
    expect(href.startsWith("/")).toBe(true);
    expect(href).not.toMatch(/^https?:/i);
    expect(href).not.toMatch(/^\/\//);

    // The event context rides as a same-origin returnTo to the event page.
    const returnTo = new URLSearchParams(href.split("?")[1]).get("returnTo");
    expect(returnTo).toBe("/webinars/ahilles-042");
  });

  it("EARS-3: the system shall keep the returnTo same-origin even for a hostile slug, never emitting an open-redirect target", () => {
    for (const evil of ["//evil.example", "https://evil.example", "../../etc"]) {
      const returnTo = new URLSearchParams(
        buildRegistrationHref(evil).split("?")[1],
      ).get("returnTo");

      // Always anchored under the same-origin /webinars/ path — a leading `//`
      // (protocol-relative) or an absolute scheme can never reach the front.
      expect(returnTo).not.toBeNull();
      expect(returnTo!.startsWith("/webinars/")).toBe(true);
      expect(returnTo).not.toMatch(/^\/\//);
      expect(returnTo).not.toMatch(/^https?:/i);
    }
  });
});

import { describe, expect, it } from "vitest";

import { DOCTOR_ROOM_ROUTES } from "./room-routes";

/**
 * 006 EARS-6 · 020 §6.1 D10 — the doctor room's refusal targets stay on
 * doctor.school.
 *
 * The invariant this pins is cross-HOST, not cosmetic: the shared room unit
 * resolves entry through whichever table its host passes, so a copy-paste of the
 * academy table would silently send an unauthenticated doctor.school visitor to
 * `academy.doctor.school/login` — a cross-origin hop whose `returnTo` the
 * Academy's same-origin guard would refuse anyway (ADR-0015 §4 REQ-24).
 */
describe("006 doctor room route table", () => {
  it("006 EARS-6: every refusal branch lands on this host's own event page, never an academy login", () => {
    const routes = DOCTOR_ROOM_ROUTES("cardio-live");

    expect(routes.entry).toEqual({
      auth: "/events/cardio-live",
      // 020 §6.1 — the bounced-registration branch carries its provenance, the
      // same `?from=room` the academy table ships.
      register: "/events/cardio-live?from=room",
      notLive: "/events/cardio-live",
    });
    for (const href of Object.values(routes.entry)) {
      expect(href.startsWith("/")).toBe(true);
      expect(href).not.toMatch(/login|academy/);
    }
  });

  it("006 EARS-11: the slug is url-encoded into every target", () => {
    const routes = DOCTOR_ROOM_ROUTES("кардио/эфир");

    expect(routes.entry.auth).toBe(`/events/${encodeURIComponent("кардио/эфир")}`);
    expect(routes.entry.register).toBe(
      `/events/${encodeURIComponent("кардио/эфир")}?from=room`,
    );
    expect(routes.room.eventPage).toBe(routes.entry.auth);
    expect(routes.room.brandHome).toBe("/");
  });
});

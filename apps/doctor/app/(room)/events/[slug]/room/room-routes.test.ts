import { describe, expect, it } from "vitest";

import { DOCTOR_ROOM_ROUTES } from "./room-routes";

/**
 * 006 EARS-6 · 020 EARS-7 / §6.1 — the doctor room's refusal targets stay on
 * doctor.school.
 *
 * The invariant this pins is cross-HOST, not cosmetic: the shared room unit
 * resolves entry through whichever table its host passes, so a copy-paste of the
 * academy table would silently send an unauthenticated doctor.school visitor to
 * `academy.doctor.school/login` — a cross-origin hop whose `returnTo` the
 * Academy's same-origin guard would refuse anyway (ADR-0015 §4 REQ-24). A guest
 * goes to THIS host's `/login` carrying a same-origin return to the room (rule S1
 * of the auth-flow standard); the two signed-in refusals land on the event page.
 */
describe("006 doctor room route table", () => {
  it("006 EARS-6: a guest is sent to this host's own login carrying a same-origin return to the room, never an academy login", () => {
    const routes = DOCTOR_ROOM_ROUTES("cardio-live");

    expect(routes.entry.auth).toBe(
      "/login?returnTo=%2Fevents%2Fcardio-live%2Froom",
    );
    for (const href of Object.values(routes.entry)) {
      expect(href.startsWith("/")).toBe(true);
      expect(href.startsWith("//")).toBe(false);
      expect(href).not.toMatch(/academy|webinars/);
    }
  });

  it("020 EARS-7: a signed-in doctor without a registration keeps the participation path, and a registered doctor before the live window gets the event page", () => {
    const routes = DOCTOR_ROOM_ROUTES("cardio-live");

    // 020 §6.1 — the bounced-registration branch carries its provenance, the
    // same `?from=room` the academy table ships.
    expect(routes.entry.register).toBe("/events/cardio-live?from=room");
    expect(routes.entry.notLive).toBe("/events/cardio-live");
  });

  it("006 EARS-11: the slug is url-encoded into every target", () => {
    const slug = "кардио/эфир";
    const routes = DOCTOR_ROOM_ROUTES(slug);
    const eventPage = `/events/${encodeURIComponent(slug)}`;

    expect(routes.entry.auth).toBe(
      `/login?returnTo=${encodeURIComponent(`${eventPage}/room`)}`,
    );
    expect(routes.entry.register).toBe(`${eventPage}?from=room`);
    expect(routes.entry.notLive).toBe(eventPage);
    expect(routes.room.eventPage).toBe(eventPage);
    expect(routes.room.brandHome).toBe("/");
  });
});

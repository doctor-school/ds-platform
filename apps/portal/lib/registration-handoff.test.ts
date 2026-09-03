import { describe, expect, it } from "vitest";

import { withReturnTarget } from "./registration-handoff";

/**
 * 005 EARS-2 — the ONWARD carry: intermediate auth navigations (`/register →
 * /verify`, the `/verify → /login` fallback, the cross links between the auth
 * pages) re-append the carried returnTo ONLY when it is a safe same-origin event
 * target, so the event context survives every hop of the 003 round-trip while a
 * hostile value is dropped at the first hop (requirements Constraints).
 */
describe("005 EARS-2 returnTo onward carry (withReturnTarget)", () => {
  it("EARS-2: the system shall carry a safe event returnTo onto the next auth navigation, preserving the event context across the hop", () => {
    expect(withReturnTarget("/login", "/webinars/ahilles-042")).toBe(
      "/login?returnTo=%2Fwebinars%2Fahilles-042",
    );
    // Appends with `&` when the path already carries a query.
    expect(
      withReturnTarget("/verify?email=doc%40example.com", "/webinars/x1"),
    ).toBe("/verify?email=doc%40example.com&returnTo=%2Fwebinars%2Fx1");
  });

  it("006 EARS-6: the system shall carry a safe room-return target (`/webinars/<slug>/room`) onto the next auth navigation, so the room context survives the signup hop", () => {
    // A visitor bounced from the room to `/login?returnTo=…/room` who clicks
    // «create account» must keep the ROOM return through `/register` (and onward
    // to `/verify`), so login OR signup both land back on the room, gate re-run.
    expect(withReturnTarget("/register", "/webinars/ahilles-042/room")).toBe(
      "/register?returnTo=%2Fwebinars%2Fahilles-042%2Froom",
    );
    expect(
      withReturnTarget("/verify?email=doc%40example.com", "/webinars/x1/room"),
    ).toBe("/verify?email=doc%40example.com&returnTo=%2Fwebinars%2Fx1%2Froom");
  });

  it("EARS-2: an absent returnTo leaves the navigation untouched (no empty param)", () => {
    expect(withReturnTarget("/login", null)).toBe("/login");
    expect(withReturnTarget("/verify?email=a%40b.c", null)).toBe(
      "/verify?email=a%40b.c",
    );
  });

  it("EARS-2: a cross-origin / open-redirect returnTo shall be dropped at the hop — never propagated onward", () => {
    for (const evil of [
      "https://evil.example/webinars/x",
      "//evil.example",
      "/\\evil.example",
      "/webinars/../account",
    ]) {
      expect(withReturnTarget("/login", evil), `must drop: ${evil}`).toBe(
        "/login",
      );
    }
  });

  it("014 EARS-6: any OTHER safe same-origin page is carried onward too, not silently lost at the hop", () => {
    // The platform-wide rule (014 EARS-6, design §6) generalizes this carry beyond
    // the 005 event page and the 006 room: a visitor sent to auth from ANY
    // login-gated surface keeps their origin across the intermediate hop. These
    // two targets were dropped before this clause landed — `/account` and a
    // multi-segment page are ordinary same-origin pages, not open redirects, and
    // dropping them was exactly the "stranded after login" defect EARS-6 repairs.
    expect(withReturnTarget("/login", "/account")).toBe(
      "/login?returnTo=%2Faccount",
    );
    expect(withReturnTarget("/login", "/webinars/a/b")).toBe(
      "/login?returnTo=%2Fwebinars%2Fa%2Fb",
    );
  });
});

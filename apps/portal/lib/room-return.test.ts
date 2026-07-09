import { describe, expect, it } from "vitest";

import { buildRoomReturnHref, parseRoomReturnTarget } from "./room-return";

/**
 * 006 EARS-6 — the room-return target guard. When an UNAUTHENTICATED visitor
 * reaches `/webinars/:slug/room` the gate refuses (401) and the room routes them
 * through the 003 auth flow carrying a `returnTo` that points back at the ROOM URL,
 * so that on login success the doctor lands on the room again and the server-side
 * gate RE-RUNS (re-evaluated on return — EARS-6). That room `returnTo` is a
 * DISTINCT shape from the 005 registration-intent (`/webinars/:slug`): it carries
 * the trailing `/room` segment and, on completion, fires NO registration — the gate
 * simply re-evaluates.
 *
 * This guard is the open-redirect defence for that room `returnTo`: it reuses the
 * hardened `@ds/schemas` slug validation (via `parseReturnTarget`) so a hostile
 * slug can never surface a cross-origin / traversal target, and it accepts ONLY a
 * canonical `/webinars/<slug>/room` — nothing else.
 */
describe("006 EARS-6 room-return target guard (parseRoomReturnTarget)", () => {
  it("EARS-6: accepts a canonical `/webinars/<slug>/room` and reconstructs the canonical room path", () => {
    const target = parseRoomReturnTarget("/webinars/ahilles-042/room");
    expect(target).toEqual({
      eventSlug: "ahilles-042",
      returnTo: "/webinars/ahilles-042/room",
    });
  });

  it("EARS-6: rejects the bare event page (no `/room` suffix) — that is the 005 registration-intent, not a room return", () => {
    expect(parseRoomReturnTarget("/webinars/ahilles-042")).toBeNull();
  });

  it("EARS-6: rejects a cross-origin / open-redirect / traversal room target — never a navigation off-origin", () => {
    for (const evil of [
      "https://evil.example/webinars/x/room",
      "//evil.example/room",
      "/\\evil.example/room",
      "/account/room",
      "/webinars/../account/room",
      "/webinars//room",
      "/webinars/a/b/room",
      "/webinars/ahilles-042/room/extra",
      "/webinars/ahilles-042/heartbeat",
      "/webinars/%2e%2e/room",
    ]) {
      expect(parseRoomReturnTarget(evil), `must reject: ${evil}`).toBeNull();
    }
  });

  it("EARS-6: rejects a non-string", () => {
    expect(parseRoomReturnTarget(null)).toBeNull();
    expect(parseRoomReturnTarget(undefined)).toBeNull();
    expect(parseRoomReturnTarget(42)).toBeNull();
  });

  it("EARS-6: builds a same-origin room href for a slug, escaping a hostile slug so it can never front a cross-origin target", () => {
    expect(buildRoomReturnHref("ahilles-042")).toBe(
      "/webinars/ahilles-042/room",
    );
    for (const evil of ["//evil.example", "https://evil.example", "../../etc"]) {
      const href = buildRoomReturnHref(evil);
      expect(href.startsWith("/webinars/")).toBe(true);
      expect(href.endsWith("/room")).toBe(true);
      expect(href).not.toMatch(/^\/\//);
      expect(href).not.toMatch(/^https?:/i);
    }
  });
});

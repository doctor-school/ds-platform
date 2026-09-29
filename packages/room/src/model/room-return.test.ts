import { describe, expect, it } from "vitest";

import {
  buildRoomReturnHref,
  parseRoomReturnTarget,
  type RoomReturnRoutes,
} from "./room-return";

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
 *
 * The room PATH is host data, not a package constant (wave-1 entry gate §2.1 rows
 * 1–5, `config: routes.room`): the Academy's template is supplied here exactly as
 * `apps/portal/lib/room-config.ts` supplies it in production.
 */
const ACADEMY_ROOM_ROUTES = {
  room: "/webinars/:slug/room",
} as const satisfies RoomReturnRoutes;

/** The doctor storefront's template, as `apps/doctor/lib/room-config.ts` states it. */
const DOCTOR_ROOM_ROUTES = {
  room: "/events/:slug/room",
} as const satisfies RoomReturnRoutes;

describe("006 EARS-6 room-return target guard (parseRoomReturnTarget)", () => {
  it("EARS-6: accepts a canonical `/webinars/<slug>/room` and reconstructs the canonical room path", () => {
    const target = parseRoomReturnTarget(
      "/webinars/ahilles-042/room",
      ACADEMY_ROOM_ROUTES,
    );
    expect(target).toEqual({
      eventSlug: "ahilles-042",
      returnTo: "/webinars/ahilles-042/room",
    });
  });

  it("EARS-6: rejects the bare event page (no `/room` suffix) — that is the 005 registration-intent, not a room return", () => {
    expect(
      parseRoomReturnTarget("/webinars/ahilles-042", ACADEMY_ROOM_ROUTES),
    ).toBeNull();
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
      expect(
        parseRoomReturnTarget(evil, ACADEMY_ROOM_ROUTES),
        `must reject: ${evil}`,
      ).toBeNull();
    }
  });

  it("019 EARS-12: a doctor-feed return target is not a room return on the academy host — no canonical room path is emitted", () => {
    // The 019 feed shape (`/events?…&resume=<slug>`) lives on the DOCTOR host. The
    // room guard strips `/room` and validates the remainder with the ACADEMY-scoped
    // parser, so a hand-built `…&resume=abc/room` cannot launder itself into a
    // "canonical room path" — and because the room check runs FIRST in
    // `completeReturnTarget`, admitting it would have won over every later branch.
    for (const feedShaped of [
      "/events?tense=upcoming&resume=abc/room",
      "/events?resume=ahilles-042/room",
      "/events/room",
    ]) {
      expect(
        parseRoomReturnTarget(feedShaped, ACADEMY_ROOM_ROUTES),
        `must reject: ${feedShaped}`,
      ).toBeNull();
    }
    // The bare feed target has no `/room` suffix at all — rejected a step earlier.
    expect(
      parseRoomReturnTarget(
        "/events?tense=upcoming&resume=abc",
        ACADEMY_ROOM_ROUTES,
      ),
    ).toBeNull();
  });

  it("EARS-6: rejects a non-string", () => {
    expect(parseRoomReturnTarget(null, ACADEMY_ROOM_ROUTES)).toBeNull();
    expect(parseRoomReturnTarget(undefined, ACADEMY_ROOM_ROUTES)).toBeNull();
    expect(parseRoomReturnTarget(42, ACADEMY_ROOM_ROUTES)).toBeNull();
  });

  it("EARS-6: a host that serves no room admits no room return — an otherwise canonical target is refused", () => {
    // `undefined` is how a host states it serves no room route (gate §2.1 row 1).
    // The codec is shared; the ROUTE is not.
    expect(
      parseRoomReturnTarget("/webinars/ahilles-042/room", undefined),
    ).toBeNull();
    expect(parseRoomReturnTarget("/webinars/ahilles-042/room", {})).toBeNull();
  });

  it("EARS-6: the doctor host's `/events/<slug>/room` is a room return there, and only there — the event guard follows the host template", () => {
    // 020 EARS-7 — the doctor storefront sends a guest from its room to its own
    // `/login` carrying `/events/<slug>/room`. The codec validates the event half
    // with the parser for the template's OWN shape (`/events/<slug>` on this
    // host), never the union: an academy room is not a doctor room and vice versa.
    expect(
      parseRoomReturnTarget("/events/cardio-live/room", DOCTOR_ROOM_ROUTES),
    ).toEqual({
      eventSlug: "cardio-live",
      returnTo: "/events/cardio-live/room",
    });
    expect(buildRoomReturnHref("cardio-live", DOCTOR_ROOM_ROUTES)).toBe(
      "/events/cardio-live/room",
    );
    expect(
      parseRoomReturnTarget("/webinars/cardio-live/room", DOCTOR_ROOM_ROUTES),
    ).toBeNull();
    expect(
      parseRoomReturnTarget("/events/cardio-live/room", ACADEMY_ROOM_ROUTES),
    ).toBeNull();
    for (const evil of [
      "/events?tense=upcoming&resume=abc/room",
      "/events/room",
      "/events/a/b/room",
      "/events/../account/room",
      "//evil.example/events/x/room",
      "https://evil.example/events/x/room",
      "/events/cardio-live",
    ]) {
      expect(
        parseRoomReturnTarget(evil, DOCTOR_ROOM_ROUTES),
        `must reject: ${evil}`,
      ).toBeNull();
    }
  });

  it("EARS-6: a template whose shape no event guard serves admits no room return — fail closed rather than widen", () => {
    expect(
      parseRoomReturnTarget("/rooms/cardio-live/room", {
        room: "/rooms/:slug/room",
      }),
    ).toBeNull();
  });

  it("EARS-6: refuses a malformed host template — `:slug` must be the template's ONE placeholder, with a suffix after it", () => {
    // Gate §2.1 contract: the host states a template with «`:slug` as its only
    // placeholder». A second placeholder would survive interpolation as a literal
    // `:slug` in a live href, so both halves of the codec refuse it outright rather
    // than shipping a half-built redirect.
    for (const malformed of [
      "/rooms/:slug/x/:slug",
      "/webinars/:slug/room/:slug",
      "/webinars/:slug",
      "/webinars/room",
      "",
    ]) {
      expect(
        parseRoomReturnTarget("/webinars/ahilles-042/room", {
          room: malformed,
        }),
        `must reject template: ${malformed}`,
      ).toBeNull();
      expect(
        () => buildRoomReturnHref("ahilles-042", { room: malformed }),
        `must refuse to build on template: ${malformed}`,
      ).toThrow(TypeError);
    }
  });

  it("EARS-6: builds a same-origin room href for a slug, escaping a hostile slug so it can never front a cross-origin target", () => {
    expect(buildRoomReturnHref("ahilles-042", ACADEMY_ROOM_ROUTES)).toBe(
      "/webinars/ahilles-042/room",
    );
    for (const evil of [
      "//evil.example",
      "https://evil.example",
      "../../etc",
    ]) {
      const href = buildRoomReturnHref(evil, ACADEMY_ROOM_ROUTES);
      expect(href.startsWith("/webinars/")).toBe(true);
      expect(href.endsWith("/room")).toBe(true);
      expect(href).not.toMatch(/^\/\//);
      expect(href).not.toMatch(/^https?:/i);
    }
  });
});

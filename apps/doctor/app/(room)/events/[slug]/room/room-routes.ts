import type { RoomEntryRoutes } from "@ds/room/server";
import type { RoomRoutes } from "@ds/room";

/**
 * 006 EARS-6 / EARS-11 · 020 §6.1 D10 (#1722, slice 3) — the DOCTOR host's room
 * route table.
 *
 * The shared room unit owns no route: `resolveRoomEntry` takes the three refusal
 * targets and `RoomShell` takes the two navigation targets, so each storefront
 * declares its own front doors here and nothing about doctor.school URLs leaks
 * into `packages/room`.
 *
 * The one branch that differs from the academy's table is `auth`, and it is the
 * reason the table is parameterised at all: doctor.school has NO login route
 * (ADR-0015 §4 REQ-24 — this host holds exactly one link into the Academy), and a
 * cross-origin `returnTo` would be refused by the Academy's same-origin guard
 * anyway. So an unauthenticated visitor is sent to THIS host's own event page,
 * where the participation card is the truthful next step — never to an academy
 * login. All three refusals therefore land on `/events/:slug`; they differ in
 * what the event page then shows (the api resolves the participation answer
 * per-viewer), not in where the visitor arrives.
 */
export interface DoctorRoomRoutes {
  /** The three EARS-6 refusal targets consumed by `resolveRoomEntry`. */
  entry: RoomEntryRoutes;
  /** The two in-room navigation targets consumed by `RoomShell`. */
  room: RoomRoutes;
}

/** Build the doctor route table for one event slug. */
export const DOCTOR_ROOM_ROUTES = (slug: string): DoctorRoomRoutes => {
  const eventPage = `/events/${encodeURIComponent(slug)}`;
  return {
    entry: {
      // No login route on this host (D10) — the event page is the honest door.
      auth: eventPage,
      // Authenticated but not on the roster: the same page, whose participation
      // card is the one-tap registration control.
      register: eventPage,
      // Registered, event not live: the truthful 020 lifecycle render.
      notLive: eventPage,
    },
    room: {
      // The doctor storefront's home — its events surface is reached from there.
      brandHome: "/",
      eventPage,
    },
  };
};

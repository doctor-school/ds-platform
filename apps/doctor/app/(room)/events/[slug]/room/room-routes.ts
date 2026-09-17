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
 * reason the table is parameterised at all. When 020 §6.1 decided it, the reason
 * was that doctor.school had no login route of its own and an ACADEMY bounce would
 * be a second Academy trace (ADR-0015 §4 REQ-24 — this host holds exactly one link
 * into the Academy), with a cross-origin `returnTo` refused by the Academy's
 * same-origin guard anyway. Since #1933 this host DOES serve `/login`, so only the
 * product half of that reasoning still stands: an unauthenticated visitor who opens
 * a room URL is sent to THIS host's own event page, where the participation card is
 * the truthful next step — signing in is not what they are missing, a registration
 * is. All three refusals therefore land on the event page; they differ in what the
 * event page then shows (the api resolves the participation answer per-viewer), not
 * in where the visitor arrives.
 *
 * This is the ONE declared exception to rule S1 of the auth-flow standard
 * (`packages/auth-flow/README.md`), which otherwise sends a guest on a closed page
 * to this host's login carrying `returnTo`. Whether the room should now bounce to
 * `/login?returnTo=/events/:slug/room` instead is a 020 §6.1 product decision whose
 * original premise has changed; it is tracked in #2265 and not settled here.
 *
 * The `register` refusal additionally carries `?from=room` (020 §6.1 table),
 * exactly as the academy's table does: a doctor who reached the room URL and was
 * turned back for having no registration arrives at the event page with the
 * provenance of that bounce, which is what lets the page own the «you came from
 * the room» framing. `auth` and `unavailable`/`notLive` carry no marker — they
 * are not bounced registrations.
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
      // Rule-S1 exception, declared above: the event page is the honest door for a
      // room URL on this host, not `/login` (020 §6.1).
      auth: eventPage,
      // Authenticated but not on the roster: the same page, whose participation
      // card is the one-tap registration control — carrying the `from=room`
      // provenance of the bounce (020 §6.1, the same shape the academy ships).
      register: `${eventPage}?from=room`,
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

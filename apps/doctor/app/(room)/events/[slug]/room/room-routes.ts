import type { RoomEntryRoutes } from "@ds/room/server";
import type { RoomRoutes } from "@ds/room";
import { buildRoomReturnHref } from "@ds/room/room-return";

import { DOCTOR_ROOM_RETURN_ROUTES } from "@/lib/room-config";

/**
 * 006 EARS-6 / EARS-11 · 020 EARS-7 / §6.1 (#1722, slice 3) — the DOCTOR
 * host's room route table.
 *
 * The shared room unit owns no route: `resolveRoomEntry` takes the three refusal
 * targets and `RoomShell` takes the two navigation targets, so each storefront
 * declares its own front doors here and nothing about doctor.school URLs leaks
 * into `packages/room`.
 *
 * The table has the academy's shape, with this host's own paths. A guest (`auth`)
 * is sent to THIS host's `/login` carrying a same-origin `returnTo` back to the
 * room, built by the shared {@link buildRoomReturnHref} from this host's template
 * (`lib/room-config.ts`), so the gate RE-RUNS on return and fires no registration
 * — rule S1 of the auth-flow standard (`packages/auth-flow/README.md`). It is
 * never an Academy login: that would be a second Academy trace (ADR-0015 §4
 * REQ-24) whose cross-origin `returnTo` the Academy's same-origin guard would
 * refuse anyway.
 *
 * The `register` refusal carries `?from=room` (020 §6.1 table), exactly as the
 * academy's table does: a doctor who reached the room URL and was turned back for
 * having no registration arrives at the event page with the provenance of that
 * bounce, which is what lets the page own the «you came from the room» framing.
 * `notLive` carries no marker — it is not a bounced registration.
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
      // Rule S1: this host's login, carrying a same-origin `returnTo` back to THIS
      // room url so the gate RE-RUNS on return (020 EARS-7 / §6.1).
      auth: `/login?returnTo=${encodeURIComponent(buildRoomReturnHref(slug, DOCTOR_ROOM_RETURN_ROUTES))}`,
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

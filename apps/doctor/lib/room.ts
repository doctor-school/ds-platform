import {
  fetchMyDisplayName,
  fetchRoomConfig,
  type RoomAccess,
} from "@ds/room/server";
import { API_BASE, type ForwardedSession } from "@/lib/session";

/**
 * 006 EARS-1 / EARS-14 (#1722, slice 3) — the doctor storefront's binding of the
 * shared `@ds/room/server` reads to THIS host's upstream.
 *
 * The shared unit takes its API origin as a parameter and never reads the
 * ambient environment (`packages/room/src/purity.test.ts` bans the read), because
 * it is hosted by two storefront processes with their own configuration. This
 * module is the doctor half of that injection and it owns exactly one fact: the
 * upstream is `lib/session.ts`'s {@link API_BASE} — the single exported base
 * every server-side read of this app addresses, never a second copy of that
 * expression.
 *
 * {@link ForwardedSession} structurally satisfies the package's `RoomSession`
 * (D16), so no adapter is needed: both are the cookie plus the two
 * fingerprint-bound headers (ADR-0001 §6) the BFF requires on a server-to-server
 * read made on the doctor's behalf.
 *
 * `fetchImpl` is injected for tests only — the same convention `lib/event-page.ts`
 * uses; production callers pass nothing.
 */

/**
 * Read the EARS-1 grant for one event on the doctor host.
 *
 * The four refusals stay the shared unit's discriminated `RoomAccess`; this host
 * maps them to its OWN route table in `app/(room)/events/[slug]/room/room-routes.ts`
 * (D10), never to the academy's flows.
 */
export function fetchDoctorRoomConfig(
  slug: string,
  session: ForwardedSession,
  fetchImpl?: typeof fetch,
): Promise<RoomAccess> {
  return fetchRoomConfig(slug, session, { apiBase: API_BASE, fetchImpl });
}

/**
 * Read the calling doctor's OWN saved display name (EARS-14 / EARS-16).
 *
 * `null` routes the client wrapper to the JIT «Имя и фамилия» prompt instead of
 * the room; a non-ok upstream is a real error and throws, per the shared read's
 * contract.
 */
export function fetchDoctorDisplayName(
  session: ForwardedSession,
  fetchImpl?: typeof fetch,
): Promise<string | null> {
  return fetchMyDisplayName(session, { apiBase: API_BASE, fetchImpl });
}

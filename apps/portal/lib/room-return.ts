import { parseReturnTarget } from "@ds/schemas";

/**
 * 006 EARS-6 — the safe ROOM-return target that rides the 003 auth round-trip when
 * an UNAUTHENTICATED visitor reaches `/webinars/:slug/room`.
 *
 * The room gate refuses a guest server-side (401); the room routes them through the
 * shipped 003 auth flow carrying a `returnTo` that points back at the ROOM url, so
 * on login (or signup) success the doctor lands on the room again and the
 * server-side gate RE-RUNS — "re-evaluated on return" (EARS-6). This is a DISTINCT
 * shape from the 005 registration-intent (`/webinars/:slug`, `registration-handoff`
 * / `registration-resume`): the room return carries the trailing `/room` segment
 * and, on completion, fires NO `RegisterForEvent` — the gate simply re-evaluates
 * (an unauthenticated visitor is never silently joined to the roster; an
 * unregistered doctor is then guided to register by the re-evaluation).
 *
 * Open-redirect safety is delegated to the hardened `@ds/schemas` slug validation:
 * the guard strips the `/room` suffix and validates the remaining
 * `/webinars/<slug>` through `parseReturnTarget`, so a cross-origin, protocol-
 * relative, backslash, or traversal target (`https://evil/…/room`, `//evil/room`,
 * `/webinars/../account/room`, `/webinars/a/b/room`) can never survive as a room
 * return. The canonical `/webinars/<slug>/room` is reconstructed from the validated
 * slug, never trusted verbatim.
 */
const ROOM_SUFFIX = "/room";

export interface RoomReturnTarget {
  /** The public slug of the event whose room the visitor was bounced from. */
  readonly eventSlug: string;
  /** The canonical same-origin room path: `/webinars/<eventSlug>/room`. */
  readonly returnTo: string;
}

/**
 * Parse a raw `returnTo` into a SAFE {@link RoomReturnTarget}, or `null` when it is
 * not a same-origin room return target. Accepts ONLY a value that resolves to
 * exactly `/webinars/<slug>/room`; everything else (the bare event page, a
 * cross-origin/traversal target, a non-string) is rejected.
 */
export function parseRoomReturnTarget(
  returnTo: unknown,
): RoomReturnTarget | null {
  if (typeof returnTo !== "string") return null;
  if (!returnTo.endsWith(ROOM_SUFFIX)) return null;

  // Strip the `/room` suffix and validate the remaining `/webinars/<slug>` through
  // the hardened registration-intent guard (single same-origin segment, no
  // traversal, SLUG_RE-safe). This reuses the open-redirect defence verbatim.
  const eventPath = returnTo.slice(0, -ROOM_SUFFIX.length);
  const intent = parseReturnTarget(eventPath);
  if (!intent) return null;

  return {
    eventSlug: intent.eventSlug,
    returnTo: `${intent.returnTo}${ROOM_SUFFIX}`,
  };
}

/** `true` iff `returnTo` is a safe same-origin room return target (EARS-6). */
export function isSafeRoomReturnTarget(returnTo: unknown): boolean {
  return parseRoomReturnTarget(returnTo) !== null;
}

/**
 * Build the same-origin room `returnTo` the auth flow carries for an event
 * identified by `slug`. The slug is `encodeURIComponent`-escaped and anchored under
 * the same-origin `/webinars/` path, so a hostile slug (`//evil`, `https://evil`,
 * `../..`) can never front a protocol-relative or cross-origin target — mirroring
 * `buildRegistrationHref` (004 EARS-3 / 005 EARS-2).
 */
export function buildRoomReturnHref(slug: string): string {
  return `/webinars/${encodeURIComponent(slug)}${ROOM_SUFFIX}`;
}

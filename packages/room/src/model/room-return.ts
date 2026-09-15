import { parseAcademyEventReturnTarget } from "@ds/schemas";

/**
 * 006 EARS-6 — the safe ROOM-return target that rides the 003 auth round-trip when
 * an UNAUTHENTICATED visitor reaches this host's room route.
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
 * The codec is SHARED (wave-1 entry gate §2.1 rows 1–5) and the room ROUTE is not:
 * the path template arrives as host data on {@link RoomReturnRoutes}, so a host
 * that serves no room (`room: undefined`) admits no room return at all rather than
 * inheriting the Academy's `/webinars/…` shape.
 *
 * Open-redirect safety is delegated to the hardened `@ds/schemas` slug validation:
 * the guard strips the room suffix and validates the remaining
 * `/webinars/<slug>` through `parseAcademyEventReturnTarget`, so a cross-origin,
 * protocol-relative, backslash, or traversal target (`https://evil/…/room`,
 * `//evil/room`, `/webinars/../account/room`, `/webinars/a/b/room`) can never
 * survive as a room return. The canonical room path is reconstructed from the
 * validated slug and the host template, never trusted verbatim.
 *
 * The parser is the ACADEMY-scoped shape, never the union: a room lives on the
 * academy host under `/webinars/`. Admitting the doctor host's feed shape here
 * would let `/events?tense=upcoming&resume=abc/room` strip its suffix, validate as
 * a feed target, and come back out as a "canonical room path" that is neither a
 * room nor an academy path — and this parser is consulted FIRST in
 * `completeReturnTarget`, so it would win.
 */

/** The `:slug` placeholder a host's room template interpolates. */
const SLUG_PLACEHOLDER = ":slug";

/**
 * The room route VALUES a host states about itself (gate §2.1 rows 1–5,
 * `config: routes.room`). Data only — never a callback.
 */
export interface RoomReturnRoutes {
  /**
   * This host's room path template, with `:slug` as its only placeholder — e.g.
   * the Academy's `/webinars/:slug/room`. `undefined` means this host serves no
   * room, and every room return is then refused.
   */
  readonly room?: string;
}

export interface RoomReturnTarget {
  /** The public slug of the event whose room the visitor was bounced from. */
  readonly eventSlug: string;
  /** The canonical same-origin room path for {@link RoomReturnTarget.eventSlug}. */
  readonly returnTo: string;
}

/**
 * Split a host's room template into the text before and after `:slug`. Returns
 * `null` for a template this codec cannot honour — no placeholder, or nothing
 * after it (a suffix-less template would make the bare event page parse as a room
 * return). Fail-closed: a malformed host value refuses room returns rather than
 * widening the guard.
 */
function splitRoomTemplate(
  template: string | undefined,
): { prefix: string; suffix: string } | null {
  if (!template) return null;
  const at = template.indexOf(SLUG_PLACEHOLDER);
  if (at === -1) return null;
  const prefix = template.slice(0, at);
  const suffix = template.slice(at + SLUG_PLACEHOLDER.length);
  if (suffix.length === 0) return null;
  return { prefix, suffix };
}

/**
 * Parse a raw `returnTo` into a SAFE {@link RoomReturnTarget}, or `null` when it is
 * not a same-origin room return target on `routes`' host. Accepts ONLY a value that
 * resolves to exactly this host's room path for a valid slug; everything else (the
 * bare event page, a cross-origin/traversal target, a non-string, any value at all
 * on a host that serves no room) is rejected.
 */
export function parseRoomReturnTarget(
  returnTo: unknown,
  routes: RoomReturnRoutes | undefined,
): RoomReturnTarget | null {
  const template = splitRoomTemplate(routes?.room);
  if (!template) return null;
  if (typeof returnTo !== "string") return null;
  if (!returnTo.endsWith(template.suffix)) return null;

  // Strip the room suffix and validate the remaining `/webinars/<slug>` through
  // the hardened registration-intent guard (single same-origin segment, no
  // traversal, SLUG_RE-safe). This reuses the open-redirect defence verbatim.
  const eventPath = returnTo.slice(0, -template.suffix.length);
  const intent = parseAcademyEventReturnTarget(eventPath);
  if (!intent) return null;

  // The guard's canonical event path must be exactly what this host's template
  // says it is. On the Academy the two agree by construction; a host whose
  // template disagrees with the shape the guard admits gets `null` instead of a
  // path neither side would serve.
  if (intent.returnTo !== `${template.prefix}${intent.eventSlug}`) return null;

  return {
    eventSlug: intent.eventSlug,
    returnTo: `${intent.returnTo}${template.suffix}`,
  };
}

/** `true` iff `returnTo` is a safe same-origin room return target (EARS-6). */
export function isSafeRoomReturnTarget(
  returnTo: unknown,
  routes: RoomReturnRoutes | undefined,
): boolean {
  return parseRoomReturnTarget(returnTo, routes) !== null;
}

/**
 * Build the same-origin room `returnTo` the auth flow carries for an event
 * identified by `slug`, on a host that DOES serve a room (hence the required
 * `room` template). The slug is `encodeURIComponent`-escaped and anchored under the
 * host's own room path, so a hostile slug (`//evil`, `https://evil`, `../..`) can
 * never front a protocol-relative or cross-origin target — mirroring the
 * server-side register href the `ParticipationCta` resolver emits
 * (004 EARS-3 / 005 EARS-2).
 */
export function buildRoomReturnHref(
  slug: string,
  routes: Required<RoomReturnRoutes>,
): string {
  return routes.room.replace(SLUG_PLACEHOLDER, encodeURIComponent(slug));
}

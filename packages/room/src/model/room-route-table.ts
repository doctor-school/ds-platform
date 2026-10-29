import type { RoomEntryRoutes } from "../server/room-entry";
import type { RoomRoutes } from "../types";
import { buildRoomReturnHref } from "./room-return";

/**
 * 006 EARS-6 / EARS-11 — the room route table, built ONCE over host values
 * (wave-4 gate row 22).
 *
 * The room owns no URL: entry resolution takes three refusal targets and the
 * composition takes two navigation targets. Each storefront states the VALUES
 * (its room path, its event-page path, its brand home, its login) and this
 * builder is the one rule that turns them into the table, so nothing about one
 * host's URLs can leak into the other's — an unauthenticated doctor.school
 * visitor never lands on an Academy login.
 *
 * The `auth` target routes through the shared {@link buildRoomReturnHref} — the
 * guard-parsed same-origin room return that `completeReturnTarget` re-admits to
 * the room (and that fires no registration on the visitor's behalf).
 */

/** The `:slug` placeholder the host's path templates interpolate. */
const SLUG_PLACEHOLDER = ":slug";

/** What a host states about its room routes. Data only. */
export interface RoomRouteTableHost {
  /** The room path template, e.g. `/webinars/:slug/room` (the room-return codec's value). */
  readonly room: string;
  /** The event-page path template, e.g. `/webinars/:slug`. */
  readonly eventPage: string;
  /** The header wordmark's brand-home target, e.g. `/webinars`. */
  readonly brandHome: string;
  /** The host's login route, e.g. `/login`. */
  readonly login: string;
  /** The host's «Мои события» page, e.g. `/account/events` — the end card's link (006 EARS-7). */
  readonly accountEvents: string;
}

/** The whole table one room render needs. */
export interface RoomRouteTable {
  /** The three EARS-6 refusal targets consumed by `resolveRoomEntry`. */
  entry: RoomEntryRoutes;
  /** The three in-room navigation targets consumed by `RoomShell`. */
  room: RoomRoutes;
}

/** Interpolate the url-encoded slug into a one-`:slug` path template. */
function interpolate(template: string, slug: string): string {
  const parts = template.split(SLUG_PLACEHOLDER);
  if (parts.length !== 2) {
    throw new TypeError(
      `event-page route template must contain exactly one \`${SLUG_PLACEHOLDER}\` placeholder: ${template}`,
    );
  }
  return `${parts[0]}${encodeURIComponent(slug)}${parts[1]}`;
}

/** Build the room route table for one event slug over the host's values. */
export function buildRoomRouteTable(
  slug: string,
  host: RoomRouteTableHost,
): RoomRouteTable {
  const eventPage = interpolate(host.eventPage, slug);
  return {
    entry: {
      // The host's login, carrying a same-origin `returnTo` back to THIS room
      // url so the gate RE-RUNS on return.
      auth: `${host.login}?returnTo=${encodeURIComponent(buildRoomReturnHref(slug, { room: host.room }))}`,
      // Signed in, not on the roster: the event page with `?from=room`, which
      // surfaces the access-branch guidance above the one-tap register door.
      register: `${eventPage}?from=room`,
      // Registered, not live: the truthful lifecycle render of the event page.
      notLive: eventPage,
    },
    room: {
      brandHome: host.brandHome,
      eventPage,
      accountEvents: host.accountEvents,
    },
  };
}

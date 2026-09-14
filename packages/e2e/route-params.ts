/**
 * DYNAMIC-SEGMENT RESOLUTION for the derived ROUTE WALK — staging/regression-
 * contour tech spec §6.3, second bullet (Issue #2067).
 *
 * The route walk reads the route manifest of the slot's build and asserts 200 +
 * a non-empty `h1` on every page route. A DYNAMIC route (`/webinars/[slug]`) has
 * no address until a golden entity supplies one, and §6.3 makes that explicit
 * rather than optional: a dynamic route with NO entry here FAILS the walk naming
 * the route, so adding a route forces its author to say which golden entity
 * renders it.
 *
 * Values are resolved LAZILY (a thunk, not a literal), because the golden
 * catalogue is read at run time from `@ds/db/seed/golden` and a slot may be
 * seeded with a different `GOLDEN_NOW`.
 *
 * The map is EMPTY today on purpose: the walk that consumes it lands with
 * deliverable 4 of this step, and an entry with no consumer would be a claim no
 * check backs. The shape §6.3 names is:
 *
 *   "/webinars/[slug]": () => golden.events.upcoming.slug
 */
import type { HostId } from "./hosts.js";

/** A dynamic route pattern exactly as the Next route manifest spells it. */
export type RoutePattern = `/${string}`;

/** Resolves the golden value that makes a dynamic route addressable. */
export type RouteParamResolver = () => string;

/**
 * Route pattern → the golden value that renders it. Keyed per host: the two
 * storefronts spell the same concept differently (`/webinars/[slug]` on academy,
 * `/events/[slug]` on doctor), so one flat map would make a missing entry on one
 * host look satisfied by the other's.
 */
export type RouteParamsMap = Readonly<
  Record<HostId, Readonly<Record<RoutePattern, RouteParamResolver>>>
>;

export const routeParams: RouteParamsMap = Object.freeze({
  academy: Object.freeze({}),
  doctor: Object.freeze({}),
});

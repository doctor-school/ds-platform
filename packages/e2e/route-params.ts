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
 * ── The gap this map deliberately leaves ─────────────────────────────────────
 * `/documents/[slug]` is missing on BOTH hosts, and that is a finding, not an
 * oversight. The golden dataset (`packages/db/src/seed/golden/`) seeds no
 * document row — its «legal documents» are Fumadocs pages plus pinned consent
 * purposes, not addressable `/documents/<slug>` entities — so there is no golden
 * value that renders the route. Per §6.3 the walk therefore FAILS naming the
 * route rather than skipping it: the route that #2012 broke stays visibly
 * unverified until the golden catalogue gains a document (tracked in the Issue),
 * which is exactly the signal a silent skip would have destroyed.
 */
import { golden } from "@ds/db/seed/golden";

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
  academy: Object.freeze({
    /** The registration happy path — published and still to come. */
    "/webinars/[slug]": () => golden.events.upcoming.slug,
    /** The room: only an event that is on air right now renders it. */
    "/webinars/[slug]/room": () => golden.events.live.slug,
  }),
  doctor: Object.freeze({
    "/events/[slug]": () => golden.events.upcoming.slug,
    "/events/[slug]/room": () => golden.events.live.slug,
  }),
});

/**
 * The resolved address for a route pattern on a host, or `undefined` when no
 * golden entity is registered for it. The walk turns `undefined` into a FAILING
 * test named after the route — never a skip (§6.3).
 */
export function resolveRoute(
  host: HostId,
  pattern: string,
): string | undefined {
  const resolver = routeParams[host][pattern as RoutePattern];
  if (!resolver) return undefined;
  return pattern.replace(/\[(?:\.\.\.)?([^\]]+)\]/g, () => resolver());
}

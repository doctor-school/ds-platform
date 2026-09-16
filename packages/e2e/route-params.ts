/**
 * DYNAMIC-SEGMENT RESOLUTION for the derived ROUTE WALK — staging/regression-
 * contour tech spec §6.3, second bullet (Issue #2067).
 *
 * The route walk reads the route manifest of the slot's build and asserts 200 +
 * a non-empty `h1` on every page route. A DYNAMIC route (`/webinars/[slug]`) has
 * no address until some catalogue supplies one, and §6.3 makes that explicit
 * rather than optional: a dynamic route with NO entry here FAILS the walk naming
 * the route, so adding a route forces its author to say which entity renders it.
 *
 * Values are resolved LAZILY (a thunk, not a literal), because the catalogues are
 * read at run time: the golden dataset from `@ds/db/seed/golden` (a slot may be
 * seeded with a different `GOLDEN_NOW`), the legal documents from
 * `@ds/legal-content`.
 *
 * ── Two catalogues, because the routes have two sources of truth ─────────────
 * `/webinars/[slug]` and `/events/[slug]` render DB rows, so their addresses come
 * from the golden seed. `/documents/[slug]` does not: a legal document is a FILE
 * in `@ds/legal-content`, and both hosts enumerate exactly that package in their
 * `generateStaticParams` (`apps/portal/app/documents/[slug]/page.tsx`,
 * `apps/doctor/app/(storefront)/documents/[slug]/page.tsx`). Resolving it from
 * the golden seed would assert an address no build ever prerenders; resolving it
 * from `listDocuments()` asks the page's own source what it published.
 */
import { golden } from "@ds/db/seed/golden";
import { listDocuments } from "@ds/legal-content";

import type { HostId } from "./hosts.js";

/** A dynamic route pattern exactly as the Next route manifest spells it. */
export type RoutePattern = `/${string}`;

/** Resolves the value that makes a dynamic route addressable. */
export type RouteParamResolver = () => string;

/**
 * The first published legal document, chosen DETERMINISTICALLY: `listDocuments()`
 * returns the catalogue sorted by slug, so the walk visits the same address on
 * every run and on both hosts, and a newly authored document never silently
 * changes what the contour asserted yesterday unless it sorts first.
 *
 * An empty catalogue throws rather than answering an address: the hosts'
 * `generateStaticParams` would then have prerendered nothing, and a walk that
 * quietly stopped asserting `/documents/[slug]` is precisely the silent skip
 * §6.3 forbids. The thunk is lazy, so the throw surfaces as a FAILING route-walk
 * test naming the route.
 */
const firstPublishedDocumentSlug: RouteParamResolver = () => {
  const [first] = listDocuments();
  if (!first) {
    throw new Error(
      "@ds/legal-content publishes no document, so /documents/[slug] has no address to walk",
    );
  }
  return first.slug;
};

/**
 * Route pattern → the value that renders it. Keyed per host: the two storefronts
 * spell the same concept differently (`/webinars/[slug]` on academy,
 * `/events/[slug]` on doctor), so one flat map would make a missing entry on one
 * host look satisfied by the other's. `/documents/[slug]` is spelled the same on
 * both and reads the same package — but it still gets a row per host, because the
 * per-host map is what proves each host's manifest entry was answered.
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
    /** A file in `@ds/legal-content`, enumerated by the page itself. */
    "/documents/[slug]": firstPublishedDocumentSlug,
  }),
  doctor: Object.freeze({
    "/events/[slug]": () => golden.events.upcoming.slug,
    "/events/[slug]/room": () => golden.events.live.slug,
    "/documents/[slug]": firstPublishedDocumentSlug,
  }),
});

/**
 * The resolved address for a route pattern on a host, or `undefined` when no
 * entity is registered for it. The walk turns `undefined` into a FAILING test
 * named after the route — never a skip (§6.3).
 */
export function resolveRoute(
  host: HostId,
  pattern: string,
): string | undefined {
  const resolver = routeParams[host][pattern as RoutePattern];
  if (!resolver) return undefined;
  return pattern.replace(/\[(?:\.\.\.)?([^\]]+)\]/g, () => resolver());
}
